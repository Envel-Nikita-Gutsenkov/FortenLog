use axum::{
    extract::{State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::Value;
use std::sync::Arc;
use crate::handlers::ingest::{AppState, normalize_os};
use crate::models::TelemetryEvent;
use uuid::Uuid;
use chrono::Utc;

pub async fn posthog_capture(
    State(state): State<Arc<AppState>>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> impl axum::response::IntoResponse {
    // Fast IP Rate Limit check (to protect DB connections and CPU)
    let ip = crate::handlers::ingest::get_client_ip(&headers, &addr);
    {
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
            state.metrics.total_rate_limited.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response();
        }
    }

    // 1. Extract API key / token
    let mut api_key = None;

    if let Some(key) = params.get("api_key").or_else(|| params.get("token")) {
        api_key = Some(key.clone());
    }

    if api_key.is_none() {
        if let Some(key) = payload.get("api_key")
            .or_else(|| payload.get("token"))
            .or_else(|| payload.get("properties").and_then(|p| p.get("token")))
            .and_then(|v| v.as_str()) {
            api_key = Some(key.to_string());
        }
    }

    let api_key = match api_key {
        Some(k) => k,
        None => return (StatusCode::UNAUTHORIZED, [("Connection", "close")]).into_response(),
    };

    // 2. Validate API key and find project_id & config
    let sys_conn = match state.db_manager.get_system_conn() {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, [("Connection", "close")]).into_response(),
    };

    let max_size_bytes: usize = 2 * 1024 * 1024;

    let project_id: Result<String, _> = sys_conn.query_row(
        "SELECT id FROM projects WHERE api_key = ?1",
        [api_key.clone()],
        |row| row.get(0)
    );

    let project_id = match project_id {
        Ok(id) => id,
        Err(_) => return (StatusCode::UNAUTHORIZED, [("Connection", "close")]).into_response(),
    };

    // 3. Extract events from batch or single payload
    let mut events = Vec::new();
    if let Some(batch) = payload.get("batch").and_then(|v| v.as_array()) {
        for item in batch {
            events.push(item.clone());
        }
    } else if payload.get("event").is_some() {
        events.push(payload.clone());
    } else {
        // If it's a heartbeat/ping from the client with just api_key
        return StatusCode::OK.into_response();
    }

    // 4. Process each event
    for mut event_val in events {
        // Apply PII stripping to the event properties
        crate::handlers::ingest::strip_pii(&mut event_val);

        let event_name = event_val.get("event")
            .and_then(|v| v.as_str())
            .unwrap_or("unnamed_event")
            .to_string();

        let properties = event_val.get("properties");

        // Extract distinct_id / hwid
        let distinct_id = event_val.get("distinct_id")
            .and_then(|v| v.as_str())
            .or_else(|| properties.and_then(|p| p.get("distinct_id")).and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| "anon".to_string());

        // Extract OS, Browser, Release, Environment from properties
        let os = normalize_os(properties.and_then(|p| p.get("$os")).and_then(|v| v.as_str()).map(|s| s.to_string()));
        let browser = properties.and_then(|p| p.get("$browser")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let release = properties.and_then(|p| p.get("$release")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let environment = properties.and_then(|p| p.get("$environment")).and_then(|v| v.as_str()).map(|s| s.to_string());

        let timestamp_str = event_val.get("timestamp")
            .or_else(|| properties.and_then(|p| p.get("timestamp")))
            .and_then(|v| v.as_str());

        let mut timestamp = timestamp_str
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);

        let now = Utc::now();
        if timestamp.signed_duration_since(now).num_hours().abs() > 24 {
            timestamp = now;
        }

        let mut body_str = event_val.to_string();
        if body_str.len() > max_size_bytes {
            let mut new_body = body_str.chars().take(max_size_bytes).collect::<String>();
            new_body.push_str("...[TRUNCATED]");
            body_str = new_body;
        }
        let payload_bytes = zstd::stream::encode_all(body_str.as_bytes(), 3)
            .unwrap_or_else(|_| body_str.as_bytes().to_vec());
        let payload_hash = crate::handlers::ingest::calculate_hash(&payload_bytes);

        let fingerprint = format!("{}-{}-{}", project_id, event_name, distinct_id).replace('/', "-");
        
        let user_ip = addr.ip().to_string();
        let rate_key = format!("{}-{}", project_id, user_ip);
        
        let mut allow = true;
        let payload_len = payload_bytes.len() as u64;

        // 10 minute limit (5 issues max, 200kb max)
        let mut stats_10m = state.ingest_rate_limit_10m.get(&rate_key).await.unwrap_or((0, 0));
        stats_10m.0 += 1;
        stats_10m.1 += payload_len;
        if stats_10m.0 > 5 || stats_10m.1 > 200 * 1024 { allow = false; }
        else { state.ingest_rate_limit_10m.insert(rate_key.clone(), stats_10m).await; }

        // 1 day limit (10 issues max)
        let mut stats_day = state.ingest_rate_limit_day.get(&rate_key).await.unwrap_or((0, 0));
        stats_day.0 += 1;
        stats_day.1 += payload_len;
        if stats_day.0 > 10 { allow = false; }
        else { state.ingest_rate_limit_day.insert(rate_key.clone(), stats_day).await; }

        if !allow {
            return (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response();
        }

        let user_fp = format!("{}-{}", fingerprint, distinct_id);
        let current_count = state.stack_cache.get(&user_fp).unwrap_or(0);
        if current_count > 50 { continue; }
        state.stack_cache.insert(user_fp, current_count + 1);

        let event = TelemetryEvent {
            id: Uuid::new_v4(),
            timestamp,
            project_id: project_id.clone(),
            issue_id: None,
            hwid: Some(distinct_id.clone()),
            event_type: "posthog".to_string(),
            payload: payload_bytes,
            payload_hash,
            fingerprint,
            ip_address: Some(user_ip),
            os,
            browser,
            region: crate::handlers::ingest::resolve_region(&Some(addr.ip().to_string())),
            tags: None,
            release_version: release,
            environment,
            title: Some(event_name),
            culprit: Some("posthog capture".to_string()),
        };

        if state.ingest_tx.try_send(event).is_err() {
            // Queue is full, return 429
            return (StatusCode::TOO_MANY_REQUESTS, [("Connection", "close")]).into_response();
        }
    }

    StatusCode::OK.into_response()
}
