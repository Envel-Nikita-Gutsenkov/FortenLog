use axum::{extract::{State, Path as AxumPath}, Json};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use axum::http::StatusCode;
use tokio::task;

// GET /api/projects/:project_id/issues/:id/events
pub async fn get_issue_events(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, issue_id)): AxumPath<(String, String)>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    // Audit check: project registry validation
    let db = Arc::clone(&state.db_manager);
    let project_exists = task::spawn_blocking({
        let db = Arc::clone(&db);
        let pid = project_id.clone();
        move || {
            if let Ok(conn) = db.get_system_conn() {
                conn.query_row("SELECT 1 FROM projects WHERE id = ?1", [pid], |_| Ok(true)).unwrap_or(false)
            } else { false }
        }
    }).await.unwrap_or(false);

    if !project_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;
    
    let result = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, timestamp, event_type, os, browser, region FROM events WHERE issue_id = ? ORDER BY timestamp DESC LIMIT 1000"
            ) {
                let events: Vec<Value> = stmt.query_map([&issue_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "timestamp": row.get::<_, String>(1)?,
                        "event_type": row.get::<_, String>(2)?,
                        "os": row.get::<_, Option<String>>(3)?,
                        "browser": row.get::<_, Option<String>>(4)?,
                        "region": row.get::<_, Option<String>>(5)?,
                    }))
                }).ok()?.filter_map(|r| r.ok()).collect();
                return Some(events);
            }
        }
        None
    }).await.unwrap_or(None);

    Ok(Json(result.unwrap_or_default()))
}

// GET /api/projects/:project_id/issues/:id/users
pub async fn get_issue_users(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, id)): AxumPath<(String, String)>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;
    
    let result = task::spawn_blocking(move || {
        let mut users = Vec::new();
        if let Ok(conn) = pool.get() {
            let total_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE issue_id = ?",
                [&id],
                |row| row.get(0)
            ).unwrap_or(1).max(1);

            if let Ok(mut stmt) = conn.prepare("
                SELECT 
                    e.ip_address, 
                    e.os, 
                    e.browser, 
                    e.region, 
                    e.release_version, 
                    MAX(e.timestamp), 
                    MAX(e.id), 
                    e.environment, 
                    COUNT(*) as ip_event_count,
                    p.data
                FROM events e 
                LEFT JOIN payloads p ON e.payload_hash = p.hash
                WHERE e.issue_id = ? 
                GROUP BY e.ip_address 
                ORDER BY MAX(e.timestamp) DESC
            ") {
                let rows = stmt.query_map([&id], |row| {
                    let ip_event_count: i64 = row.get(8)?;
                    let percentage = ((ip_event_count as f64 / total_count as f64) * 100.0).round() as i64;
                    let payload_bytes: Option<Vec<u8>> = row.get(9).ok();
                    
                    let mut cpu_description = None;
                    if let Some(bytes) = payload_bytes {
                        if let Ok(decompressed) = zstd::stream::decode_all(&bytes[..]) {
                            if let Ok(decompressed_str) = std::str::from_utf8(&decompressed) {
                                if let Some(line) = decompressed_str.lines().next() {
                                    if let Ok(payload) = serde_json::from_str::<Value>(line) {
                                        cpu_description = payload
                                            .pointer("/contexts/device/cpu_description")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string());
                                    }
                                }
                            }
                        }
                    }

                    Ok(json!({
                        "ip": row.get::<_, Option<String>>(0)?,
                        "os": row.get::<_, Option<String>>(1)?,
                        "browser": row.get::<_, Option<String>>(2)?,
                        "region": row.get::<_, Option<String>>(3)?,
                        "version": row.get::<_, Option<String>>(4)?,
                        "last_seen": row.get::<_, String>(5)?,
                        "event_id": row.get::<_, String>(6)?,
                        "environment": row.get::<_, Option<String>>(7)?,
                        "event_count": ip_event_count,
                        "percentage": percentage,
                        "cpu": cpu_description,
                    }))
                }).ok()?;
                
                for row in rows {
                    if let Ok(u) = row { users.push(u); }
                }
            }
        }
        Some(users)
    }).await.unwrap_or(None).unwrap_or_default();
    
    Ok(Json(result))
}

// GET /api/projects/:project_id/issues/:id/events/:event_id
pub async fn get_event_detail(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, _issue_id, event_id)): AxumPath<(String, String, String)>,
) -> Result<Json<Value>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;
    
    let result = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare("SELECT e.id, e.timestamp, e.event_type, e.os, e.browser, e.region, e.payload_hash, p.data FROM events e LEFT JOIN payloads p ON e.payload_hash = p.hash WHERE e.id = ?") {
                let res = stmt.query_row([&event_id], |row| {
                    let payload_bytes: Option<Vec<u8>> = row.get(7).ok();
                    let mut event_obj = json!({
                        "id": row.get::<_, String>(0)?,
                        "timestamp": row.get::<_, String>(1)?,
                        "event_type": row.get::<_, String>(2)?,
                        "os": row.get::<_, Option<String>>(3)?,
                        "browser": row.get::<_, Option<String>>(4)?,
                        "region": row.get::<_, Option<String>>(5)?,
                    });

                    if let Some(bytes) = payload_bytes {
                        // On-the-fly decompression (ZSTD)
                        let decompressed = match zstd::stream::decode_all(&bytes[..]) {
                            Ok(d) => d,
                            Err(_) => bytes, // Fallback to raw if not compressed or failed
                        };

                        if let Ok(decompressed_str) = std::str::from_utf8(&decompressed) {
                            for line in decompressed_str.lines() {
                                if let Ok(payload) = serde_json::from_str::<Value>(line) {
                                    if let Some(obj) = event_obj.as_object_mut() {
                                        if let Some(p_obj) = payload.as_object() {
                                            for (k, v) in p_obj {
                                                obj.insert(k.clone(), v.clone());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(event_obj)
                }).ok();
                if let Some(r) = res { return Some(r); }
            }
        }
        None
    }).await.unwrap_or(None);

    Ok(Json(result.unwrap_or_else(|| json!({ "error": "Event not found" }))))
}

// GET /api/system/events (admin only!)
pub async fn get_all_events(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    
    let db = Arc::clone(&state.db_manager);
    let result = task::spawn_blocking(move || {
        let projects: Vec<String> = if let Ok(conn) = db.get_system_conn() {
            if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                stmt.query_map([], |row| row.get::<_, String>(0)).ok()?.filter_map(|r| r.ok()).collect()
            } else { vec![] }
        } else { vec![] };

        let mut all = Vec::new();
        for pid in projects {
            if let Ok(pool) = db.get_project_pool(&pid) {
                if let Ok(conn) = pool.get() {
                    if let Ok(mut stmt) = conn.prepare("SELECT id, timestamp, event_type, os, browser, region, release_version, title, ip_address FROM events ORDER BY timestamp DESC LIMIT 100") {
                        let events: Vec<Value> = stmt.query_map([], |row| {
                            Ok(json!({
                                "id": row.get::<_, String>(0)?,
                                "timestamp": row.get::<_, String>(1)?,
                                "event_type": row.get::<_, String>(2)?,
                                "os": row.get::<_, Option<String>>(3)?,
                                "browser": row.get::<_, Option<String>>(4)?,
                                "region": row.get::<_, Option<String>>(5)?,
                                "release_version": row.get::<_, Option<String>>(6)?,
                                "title": row.get::<_, Option<String>>(7)?,
                                "ip_address": row.get::<_, Option<String>>(8)?,
                                "project_id": pid.clone(),
                            }))
                        }).ok()?.filter_map(|r| r.ok()).collect();
                        all.extend(events);
                    }
                }
            }
        }
        all.sort_by(|a, b| b["timestamp"].as_str().unwrap_or("").cmp(a["timestamp"].as_str().unwrap_or("")));
        Some(all.into_iter().take(100).collect())
    }).await.unwrap_or(None);

    Ok(Json(result.unwrap_or_default()))
}

// GET /api/projects/:project_id/issues/:id
pub async fn get_issue_detail(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, id)): AxumPath<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;
    
    let result = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare("
                SELECT id, title, culprit, status, count, users_affected, first_seen, last_seen, is_suppressed, resolved_in_version 
                FROM issues 
                WHERE id = ?
            ") {
                let res = stmt.query_row([&id], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "title": row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        "culprit": row.get::<_, Option<String>>(2)?,
                        "status": row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "unhandled".to_string()),
                        "count": row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                        "users_affected": row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                        "first_seen": row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        "last_seen": row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                        "is_suppressed": row.get::<_, Option<i32>>(8)?.unwrap_or(0) == 1,
                        "resolved_in_version": row.get::<_, Option<String>>(9)?,
                        "project_id": project_id.clone(),
                    }))
                }).ok();
                if let Some(r) = res { return Some(r); }
            }
        }
        None
    }).await.unwrap_or(None);

    Ok(Json(result.unwrap_or_else(|| json!({ "error": "Issue not found" }))))
}
