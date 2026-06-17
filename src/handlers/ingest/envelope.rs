use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde_json::Value;
use std::sync::Arc;
use crate::handlers::ingest::{AppState, strip_pii, calculate_hash, resolve_region, normalize_os};
use crate::models::TelemetryEvent;
use crate::middleware::auth::mask_ip;
use uuid::Uuid;
use chrono::Utc;
use zstd::stream::encode_all;
use std::sync::atomic::Ordering;

pub async fn sentry_envelope(
    State(state): State<Arc<AppState>>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    headers: axum::http::HeaderMap,
    Path(project_id): Path<String>,
    body: String,
) -> impl axum::response::IntoResponse {
    let start_time = std::time::Instant::now();
    state.metrics.total_received.fetch_add(1, Ordering::Relaxed);

    let ip = crate::handlers::ingest::get_client_ip(&headers, &addr);
    let is_loopback = ip == "127.0.0.1" || ip == "::1";
    if !is_loopback {
        let key = format!("ip_limit:{}", ip);
        let mut stats = state.ip_rate_limit.get(&key).await.unwrap_or((0, std::time::Instant::now()));
        
        if stats.1.elapsed().as_secs() > 60 {
            stats.0 = 1;
            stats.1 = std::time::Instant::now();
        } else {
            stats.0 += 1;
        }
        
        state.ip_rate_limit.insert(key, stats).await;

        if stats.0 > 100 {
            state.metrics.total_rate_limited.fetch_add(1, Ordering::Relaxed);
            return (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response();
        }
    }

    let sys_conn = match state.db_manager.get_system_conn() {
        Ok(c) => c,
        Err(_) => {
            state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
            state.db_manager.log_internal_error("sentry_envelope", "Failed to get system DB connection", None);
            return (StatusCode::INTERNAL_SERVER_ERROR, [("Connection", "close")]).into_response();
        }
    };

    let expected_key: Option<String> = sys_conn.query_row(
        "SELECT api_key FROM projects WHERE id = ?1",
        [project_id.clone()],
        |row| row.get(0)
    ).ok();

    // Always return UNAUTHORIZED for any auth failure — never reveal whether project exists.
    // Different status codes (404 vs 401) would allow enumeration of valid project IDs.
    let expected_key = match expected_key {
        Some(k) => k,
        None => {
            state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
            return (StatusCode::UNAUTHORIZED, [("Connection", "close")]).into_response();
        }
    };

    // Extract Sentry API key from query parameter or X-Sentry-Auth header
    let mut api_key = None;
    if let Some(key) = params.get("sentry_key") {
        api_key = Some(key.clone());
    } else if let Some(auth_header) = headers.get("X-Sentry-Auth") {
        if let Ok(auth_str) = auth_header.to_str() {
            for part in auth_str.split(',') {
                let part = part.trim();
                if part.starts_with("sentry_key=") {
                    api_key = Some(part["sentry_key=".len()..].to_string());
                    break;
                }
            }
        }
    }

    // Constant-time comparison prevents timing attacks on api_key
    let key_matches = api_key.as_deref().map(|k| {
        use std::hint;
        let a = k.as_bytes();
        let b = expected_key.as_bytes();
        if a.len() != b.len() {
            // Still iterate to equalize time (avoid short-circuit on length)
            let _ = a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y));
            return false;
        }
        let diff = a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y));
        hint::black_box(diff) == 0
    }).unwrap_or(false);

    if !key_matches {
        state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
        return (StatusCode::UNAUTHORIZED, [("Connection", "close")]).into_response();
    }

    if body.trim().is_empty() {
        state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
        return (StatusCode::BAD_REQUEST, [("Connection", "close")]).into_response();
    }

    // Line length and count checks to protect against malformed payload CPU/memory exhaustion
    let mut line_count = 0;
    for line in body.lines() {
        line_count += 1;
        if line_count > 50 {
            state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
            return (StatusCode::BAD_REQUEST, [("Connection", "close")]).into_response();
        }
        if line.len() > 256 * 1024 {
            state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
            return (StatusCode::BAD_REQUEST, [("Connection", "close")]).into_response();
        }
    }

    // Project-level ingestion rate limits (10m and 1day limits)
    let rate_key = format!("{}-{}", project_id, ip);
    let mut allow = true;
    let payload_len = body.as_bytes().len() as u64;

    if !is_loopback {
        // 10 minute limit (5 issues max, 200kb max)
        let mut stats_10m = state.ingest_rate_limit_10m.get(&rate_key).await.unwrap_or((0, 0));
        stats_10m.0 += 1;
        stats_10m.1 += payload_len;
        if stats_10m.0 > 5 || stats_10m.1 > 200 * 1024 {
            allow = false;
        } else {
            state.ingest_rate_limit_10m.insert(rate_key.clone(), stats_10m).await;
        }

        // 1 day limit (10 issues max)
        let mut stats_day = state.ingest_rate_limit_day.get(&rate_key).await.unwrap_or((0, 0));
        stats_day.0 += 1;
        stats_day.1 += payload_len;
        if stats_day.0 > 10 {
            allow = false;
        } else {
            state.ingest_rate_limit_day.insert(rate_key.clone(), stats_day).await;
        }
    }

    if !allow {
        state.metrics.total_rate_limited.fetch_add(1, Ordering::Relaxed);
        return (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response();
    }

    let mut os = None;
    let mut browser = None;
    let mut release = None;
    let mut environment = None;
    let mut hwid = None;
    let mut exception_type = "Error".to_string();
    let mut exception_value = "Unknown".to_string();
    let mut culprit = "unknown source".to_string();
    
    let mut is_session = false;
    let mut session_status = "ok".to_string();
    
    for line in body.lines() {
        if let Ok(json) = serde_json::from_str::<Value>(line) {
            // Check for session item
            if let Some(t) = json.get("type").and_then(|v| v.as_str()) {
                if t == "session" { is_session = true; }
            }
            if is_session {
                if let Some(s) = json.get("status").and_then(|v| v.as_str()) { session_status = s.to_string(); }
            }

            if let Some(exc) = json.get("exception").and_then(|e| e.get("values")).and_then(|v| v.get(0)) {
                if let Some(t) = exc.get("type").and_then(|v| v.as_str()) { exception_type = t.to_string(); }
                if let Some(v) = exc.get("value").and_then(|v| v.as_str()) { exception_value = v.to_string(); }
                if let Some(frames) = exc.get("stacktrace").and_then(|s| s.get("frames")).and_then(|f| f.as_array()) {
                    if let Some(last_frame) = frames.last() {
                        let file = last_frame.get("filename").and_then(|v| v.as_str()).unwrap_or("unknown");
                        let func = last_frame.get("function").and_then(|v| v.as_str()).unwrap_or("anon");
                        culprit = format!("{} in {}", file, func);
                    }
                }
            } else if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                exception_value = msg.to_string();
            } else if let Some(msg) = json.get("logentry").and_then(|l| l.get("message")).and_then(|v| v.as_str()) {
                exception_value = msg.to_string();
            }

            if let Some(contexts) = json.get("contexts") {
                os = normalize_os(contexts.get("os").and_then(|o| o.get("name")).and_then(|v| v.as_str()).map(|s| s.to_string()));
                browser = contexts.get("browser").and_then(|b| b.get("name")).and_then(|v| v.as_str()).map(|s| s.to_string());
                if let Some(device) = contexts.get("device") { hwid = device.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()); }
            }
            if let Some(r) = json.get("release").and_then(|v| v.as_str()) { release = Some(r.to_string()); }
            if let Some(e) = json.get("environment").and_then(|v| v.as_str()) { environment = Some(e.to_string()); }
        }
    }

    // Strict validation: Reject events that contain neither exception details nor message, and are not sessions
    if !is_session && exception_type == "Error" && exception_value == "Unknown" {
        state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
        return (StatusCode::BAD_REQUEST, [("Connection", "close")]).into_response();
    }

    // Always record a session if it's explicitly a session item OR if it's an error event (to track stability)
    if is_session || exception_type != "Error" || exception_value != "Unknown" {
        let session = crate::models::SessionEvent {
            id: Uuid::new_v4(),
            project_id: project_id.clone(),
            hwid: hwid.clone(),
            release_version: release.clone(),
            environment: environment.clone(),
            timestamp: Utc::now(),
            is_error: session_status != "ok" || exception_type != "Error",
        };
        let _ = state.session_tx.send(session).await;
    }

    // If it was ONLY a session heartbeat, we are done
    if is_session && exception_type == "Error" && exception_value == "Unknown" {
        let latency_micros = start_time.elapsed().as_micros() as u64;
        state.metrics.last_latency_micros.store(latency_micros, Ordering::Relaxed);
        state.metrics.total_processed.fetch_add(1, Ordering::Relaxed);
        return StatusCode::OK.into_response();
    }

    let mut stripped_lines = Vec::new();
    for line in body.lines() {
        if let Ok(mut json) = serde_json::from_str::<Value>(line) {
            strip_pii(&mut json);
            stripped_lines.push(json.to_string());
        } else {
            stripped_lines.push(line.to_string());
        }
    }
    let body = stripped_lines.join("\n");

    let fingerprint = format!("{}-{}-{}", project_id, exception_type, exception_value).replace('/', "-");
    let user_fp = format!("{}-{}", fingerprint, hwid.as_deref().unwrap_or("anon"));
    let current_count = state.stack_cache.get(&user_fp).unwrap_or(0);
    if current_count > 50 {
        let latency_micros = start_time.elapsed().as_micros() as u64;
        state.metrics.last_latency_micros.store(latency_micros, Ordering::Relaxed);
        state.metrics.total_processed.fetch_add(1, Ordering::Relaxed);
        return StatusCode::OK.into_response();
    }
    state.stack_cache.insert(user_fp, current_count + 1);

    let payload_bytes = encode_all(body.as_bytes(), 3).unwrap_or_else(|_| body.as_bytes().to_vec());
    let payload_hash = calculate_hash(&payload_bytes);
    
    let event = TelemetryEvent {
        id: Uuid::new_v4(),
        timestamp: Utc::now(),
        project_id,
        issue_id: None,
        hwid,
        event_type: "sentry".to_string(),
        payload: payload_bytes,
        payload_hash,
        fingerprint,
        ip_address: Some(mask_ip(&ip)),
        os,
        browser,
        region: resolve_region(&Some(ip.clone())),
        tags: None,
        release_version: release,
        environment,
        title: Some(format!("{}: {}", exception_type, exception_value)),
        culprit: Some(culprit),
    };

    if state.ingest_tx.try_send(event).is_ok() {
        let latency_micros = start_time.elapsed().as_micros() as u64;
        state.metrics.last_latency_micros.store(latency_micros, Ordering::Relaxed);
        state.metrics.total_processed.fetch_add(1, Ordering::Relaxed);
        StatusCode::OK.into_response()
    } else {
        state.metrics.total_dropped.fetch_add(1, Ordering::Relaxed);
        state.db_manager.log_internal_error("sentry_envelope", "Ingestion channel full/closed", None);
        (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response()
    }
}
