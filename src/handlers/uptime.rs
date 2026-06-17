use axum::{
    extract::{State, Json, Path, Query},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use uuid::Uuid;
use rusqlite::params;

#[derive(Serialize, Deserialize)]
pub struct Monitor {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub url: String,
    pub interval_secs: i64,
    pub status: String,
}

#[derive(Serialize, Deserialize)]
pub struct MonitorLog {
    pub timestamp: String,
    pub latency_ms: i64,
    pub status_code: i64,
    pub is_up: bool,
}

#[derive(Deserialize)]
pub struct ListMonitorsParams {
    pub project_id: Option<String>,
}

pub async fn list_monitors(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Query(params): Query<ListMonitorsParams>,
) -> Result<Json<Vec<Monitor>>, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let is_admin = claims.is_admin;
    let target_project = params.project_id;

    let monitors = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ = conn.execute("CREATE TABLE IF NOT EXISTS uptime_monitors (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, url TEXT, interval_secs INTEGER, status TEXT DEFAULT 'unknown')", []);

        // Fetch allowed projects for non-admin
        let allowed_projects: Option<String> = if !is_admin {
            conn.query_row(
                "SELECT allowed_projects FROM users WHERE username = ?1",
                [&username],
                |row| row.get(0)
            ).unwrap_or(None)
        } else {
            None
        };

        let mut query = "SELECT id, name, url, interval_secs, status, project_id FROM uptime_monitors".to_string();
        let mut sql_params: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(pid) = target_project {
            if pid != "all" {
                query.push_str(" WHERE project_id = ?1");
                sql_params.push(pid.into());
            }
        }

        let mut stmt = conn.prepare(&query).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(sql_params), |row| {
            Ok(Monitor {
                id: row.get(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                interval_secs: row.get(3)?,
                status: row.get(4)?,
                project_id: row.get(5)?,
            })
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(m) = row {
                // Filter by allowed projects for non-admin
                if !is_admin {
                    if let Some(ref pid) = m.project_id {
                        if let Some(ref allowed) = allowed_projects {
                            let list: Vec<&str> = allowed.split(',').map(|s| s.trim()).collect();
                            if list.contains(&pid.as_str()) {
                                result.push(m);
                            }
                        }
                    }
                } else {
                    result.push(m);
                }
            }
        }
        Ok::<_, StatusCode>(result)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(monitors))
}

#[derive(Deserialize)]
pub struct CreateMonitorPayload {
    pub project_id: String,
    pub name: String,
    pub url: String,
    pub interval_secs: Option<i64>,
}

pub async fn create_monitor(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<CreateMonitorPayload>,
) -> Result<StatusCode, StatusCode> {
    // Audit & Authorization validation
    if !claims.is_admin {
        tracing::warn!("[AUTH_VIOLATION] Non-admin user '{}' attempted to create uptime monitor '{}'", claims.sub, payload.name);
        return Err(StatusCode::FORBIDDEN);
    }

    let db = Arc::clone(&state.db_manager);
    let id = Uuid::new_v4().to_string();
    let interval = payload.interval_secs.unwrap_or(60);
    let project_id = payload.project_id;
    
    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute(
            "INSERT INTO uptime_monitors (id, project_id, name, url, interval_secs) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, project_id, payload.name, payload.url, interval],
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok::<_, StatusCode>(StatusCode::CREATED)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

pub async fn delete_monitor(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // Audit & Authorization validation
    if !claims.is_admin {
        tracing::warn!("[AUTH_VIOLATION] Non-admin user '{}' attempted to delete uptime monitor '{}'", claims.sub, id);
        return Err(StatusCode::FORBIDDEN);
    }

    let db = Arc::clone(&state.db_manager);
    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        
        // Delete child logs first to avoid Foreign Key constraint violations
        let _ = conn.execute("DELETE FROM uptime_logs WHERE monitor_id = ?1", [&id]);
        
        conn.execute("DELETE FROM uptime_monitors WHERE id = ?1", [&id]).map_err(|e| {
            tracing::error!("Failed to delete uptime monitor: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        
        Ok::<_, StatusCode>(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

pub async fn get_monitor_logs(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<MonitorLog>>, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let logs = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ = conn.execute("CREATE TABLE IF NOT EXISTS uptime_logs (monitor_id TEXT, timestamp TEXT DEFAULT CURRENT_TIMESTAMP, latency_ms INTEGER, status_code INTEGER, is_up INTEGER)", []);

        let mut stmt = conn.prepare("SELECT timestamp, latency_ms, status_code, is_up FROM uptime_logs WHERE monitor_id = ?1 ORDER BY timestamp DESC LIMIT 5000").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map([id], |row| {
            Ok(MonitorLog {
                timestamp: row.get(0)?,
                latency_ms: row.get(1)?,
                status_code: row.get(2)?,
                is_up: row.get::<_, i32>(3)? != 0,
            })
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(l) = row { result.push(l); }
        }
        Ok::<_, StatusCode>(result)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(logs))
}

pub async fn uptime_worker(db_manager: Arc<crate::db::DbManager>) {
    let client = reqwest::Client::builder()
        .user_agent("FortenLog-Uptime-Bot/1.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    loop {
        let db = Arc::clone(&db_manager);
        let monitors = tokio::task::spawn_blocking(move || {
            if let Ok(conn) = db.get_system_conn() {
                 let _ = conn.execute("CREATE TABLE IF NOT EXISTS uptime_monitors (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, url TEXT, interval_secs INTEGER, status TEXT DEFAULT 'unknown')", []);
                 if let Ok(mut stmt) = conn.prepare("SELECT id, name, url, status FROM uptime_monitors") {
                      return stmt.query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                      }).map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>()).unwrap_or_default();
                 }
            }
            Vec::new()
        }).await.unwrap_or_default();

        // Spawn checks in parallel to avoid sequential blocking & slow timeouts
        for (id, name, url, old_status) in monitors {
            let client = client.clone();
            let db_manager = Arc::clone(&db_manager);
            
            tokio::spawn(async move {
                let start = std::time::Instant::now();
                let res = client.get(&url).timeout(std::time::Duration::from_secs(10)).send().await;
                let latency = start.elapsed().as_millis() as i64;
                
                let (is_up, status_code) = match res {
                    Ok(resp) => (resp.status().is_success(), resp.status().as_u16() as i64),
                    Err(_) => (false, 0),
                };

                let status = if is_up { "up" } else { "down" };

                // State Transition Detection & Notification Dispatch
                if old_status != "unknown" && old_status != status {
                    if status == "down" {
                        tracing::warn!(
                            "[SYSTEM_ALERT] Uptime monitor '{}' ({}) has gone DOWN! Status: {}, Latency: {}ms",
                            name, url, status_code, latency
                        );
                    } else {
                        tracing::info!(
                            "[SYSTEM_INFO] Uptime monitor '{}' ({}) has RECOVERED and is now UP. Latency: {}ms",
                            name, url, latency
                        );
                    }
                }

                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(conn) = db_manager.get_system_conn() {
                        let _ = conn.execute("CREATE TABLE IF NOT EXISTS uptime_logs (monitor_id TEXT, timestamp TEXT DEFAULT CURRENT_TIMESTAMP, latency_ms INTEGER, status_code INTEGER, is_up INTEGER)", []);
                        
                        // Smart logging logic:
                        // Always write failed (down) checks.
                        // For successful (up) checks, only write a baseline telemetry log if at least 15 minutes have passed since the last baseline log.
                        let mut write_log = true;
                        
                        if is_up {
                            if let Ok(mut exists_stmt) = conn.prepare(
                                "SELECT 1 FROM uptime_logs WHERE monitor_id = ?1 AND is_up = 1 AND timestamp >= datetime('now', '-15 minutes') LIMIT 1"
                            ) {
                                if exists_stmt.exists([&id]).unwrap_or(false) {
                                    // A stable UP log was already written within the last 15 minutes, skip redundant writing!
                                    write_log = false;
                                }
                            }
                        }

                        if write_log {
                            let _ = conn.execute(
                                "INSERT INTO uptime_logs (monitor_id, latency_ms, status_code, is_up) VALUES (?1, ?2, ?3, ?4)",
                                params![id, latency, status_code, if is_up { 1 } else { 0 }],
                            );
                        }

                        let _ = conn.execute("UPDATE uptime_monitors SET status = ?1 WHERE id = ?2", [status, &id]);
                        
                        // Smart Retention Pruning: Delete all logs older than 30 days (1 month) to save space and resources
                        let _ = conn.execute(
                            "DELETE FROM uptime_logs WHERE timestamp < datetime('now', '-30 days')",
                            [],
                        );
                    }
                }).await;
            });
        }
        
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}
