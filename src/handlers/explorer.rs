use axum::{extract::{State, Query, Path as AxumPath}, Json};
use serde::{Deserialize};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use tokio::task;

use crate::handlers::auth::Claims;
use axum::http::StatusCode;

#[derive(Deserialize)]
pub struct QueryParams {
    pub project_id: Option<String>,
    pub event_type: Option<String>,
    pub os: Option<String>,
    pub browser: Option<String>,
    pub search: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

struct ReceiverStream {
    rx: tokio::sync::mpsc::Receiver<Result<axum::body::Bytes, std::io::Error>>,
}

impl futures_util::stream::Stream for ReceiverStream {
    type Item = Result<axum::body::Bytes, std::io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

pub async fn query_events(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Query(params): Query<QueryParams>,
) -> Result<Json<Value>, StatusCode> {
    if let Some(ref pid) = params.project_id {
        if !crate::handlers::auth::check_project_access(&state, &claims, pid).await {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let db = Arc::clone(&state.db_manager);
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);
    let fetch_limit = (limit + offset) as i64;

    // Fetch allowed projects for non-admin
    let allowed_projects: Option<String> = if !claims.is_admin {
        let db_clone = db.clone();
        let username = claims.sub.clone();
        task::spawn_blocking(move || {
            if let Ok(conn) = db_clone.get_system_conn() {
                conn.query_row(
                    "SELECT allowed_projects FROM users WHERE username = ?1",
                    [&username],
                    |row| row.get(0)
                ).unwrap_or(None)
            } else {
                None
            }
        }).await.unwrap_or(None)
    } else {
        None
    };

    let result = task::spawn_blocking(move || {
        let projects: Vec<String> = if let Some(pid) = &params.project_id {
            if !pid.is_empty() {
                vec![pid.clone()]
            } else {
                if !claims.is_admin {
                    allowed_projects.clone().unwrap_or_default()
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                } else if let Ok(conn) = db.get_system_conn() {
                    if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                        stmt.query_map([], |row| row.get::<_, String>(0)).map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default()
                    } else { vec![] }
                } else { vec![] }
            }
        } else {
            if !claims.is_admin {
                allowed_projects.clone().unwrap_or_default()
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else if let Ok(conn) = db.get_system_conn() {
                if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                    stmt.query_map([], |row| row.get::<_, String>(0)).map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default()
                } else { vec![] }
            } else { vec![] }
        };

        let mut all_events = Vec::new();
        for pid in projects {
            if let Ok(pool) = db.get_project_pool(&pid) {
                if let Ok(conn) = pool.get() {
                    let mut query = "SELECT e.id, e.timestamp, e.event_type, e.os, e.browser, e.region, COALESCE(e.title, i.title), e.ip_address, e.issue_id \
                                     FROM events e LEFT JOIN issues i ON e.issue_id = i.id WHERE 1=1".to_string();
                    let mut sql_params: Vec<String> = Vec::new();

                    if let Some(et) = &params.event_type {
                        if !et.is_empty() {
                            query.push_str(" AND e.event_type = ?");
                            sql_params.push(et.clone());
                        }
                    }
                    if let Some(os) = &params.os {
                        if !os.is_empty() {
                            query.push_str(" AND e.os = ?");
                            sql_params.push(os.clone());
                        }
                    }
                    if let Some(br) = &params.browser {
                        if !br.is_empty() {
                            query.push_str(" AND e.browser = ?");
                            sql_params.push(br.clone());
                        }
                    }
                    if let Some(s) = &params.search {
                        if !s.is_empty() {
                            query.push_str(" AND (i.title LIKE ? OR e.title LIKE ? OR e.id LIKE ?)");
                            let search_pattern = format!("%{}%", s);
                            sql_params.push(search_pattern.clone());
                            sql_params.push(search_pattern.clone());
                            sql_params.push(search_pattern);
                        }
                    }

                    query.push_str(" ORDER BY e.timestamp DESC LIMIT ? OFFSET 0");

                    if let Ok(mut stmt) = conn.prepare(&query) {
                        let mut params_refs: Vec<&dyn rusqlite::ToSql> = Vec::new();
                        for p in &sql_params {
                            params_refs.push(p);
                        }
                        params_refs.push(&fetch_limit);

                        let events: Vec<Value> = stmt.query_map(rusqlite::params_from_iter(params_refs), |row| {
                            Ok(json!({
                                "id": row.get::<_, String>(0)?,
                                "timestamp": row.get::<_, String>(1)?,
                                "event_type": row.get::<_, String>(2)?,
                                "os": row.get::<_, Option<String>>(3)?,
                                "browser": row.get::<_, Option<String>>(4)?,
                                "region": row.get::<_, Option<String>>(5)?,
                                "title": row.get::<_, Option<String>>(6)?,
                                "ip_address": row.get::<_, Option<String>>(7)?,
                                "project_id": pid.clone(),
                                "issue_id": row.get::<_, Option<String>>(8)?,
                            }))
                        }).map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default();
                        
                        all_events.extend(events);
                    }
                }
            }
        }
        
        all_events.sort_by(|a, b| b["timestamp"].as_str().unwrap_or("").cmp(a["timestamp"].as_str().unwrap_or("")));
        let total = all_events.len();
        let limited: Vec<Value> = all_events.into_iter().skip(offset).take(limit).collect();

        Some(json!({
            "events": limited,
            "total": total
        }))
    }).await.unwrap_or(None);

    Ok(Json(result.unwrap_or_else(|| json!({ "events": [], "total": 0 }))))
}

pub async fn export_explorer(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Query(params): Query<QueryParams>,
) -> Result<impl axum::response::IntoResponse, StatusCode> {
    if let Some(ref pid) = params.project_id {
        if !crate::handlers::auth::check_project_access(&state, &claims, pid).await {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let db = Arc::clone(&state.db_manager);
    
    // Fetch allowed projects for non-admin
    let allowed_projects: Option<String> = if !claims.is_admin {
        let db_clone = db.clone();
        let username = claims.sub.clone();
        task::spawn_blocking(move || {
            if let Ok(conn) = db_clone.get_system_conn() {
                conn.query_row(
                    "SELECT allowed_projects FROM users WHERE username = ?1",
                    [&username],
                    |row| row.get(0)
                ).unwrap_or(None)
            } else {
                None
            }
        }).await.unwrap_or(None)
    } else {
        None
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);

    tokio::task::spawn_blocking(move || {
        let projects: Vec<String> = if let Some(pid) = &params.project_id {
            if !pid.is_empty() {
                vec![pid.clone()]
            } else {
                if !claims.is_admin {
                    allowed_projects.clone().unwrap_or_default()
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                } else if let Ok(conn) = db.get_system_conn() {
                    if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                        stmt.query_map([], |row| row.get::<_, String>(0)).map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default()
                    } else { vec![] }
                } else { vec![] }
            }
        } else {
            if !claims.is_admin {
                allowed_projects.clone().unwrap_or_default()
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else if let Ok(conn) = db.get_system_conn() {
                if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                    stmt.query_map([], |row| row.get::<_, String>(0)).map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default()
                } else { vec![] }
            } else { vec![] }
        };

        // Send header row
        if tx.blocking_send(Ok(axum::body::Bytes::from("ID,Timestamp,Type,Title,OS,Browser,Region,IP,ProjectID\n"))).is_err() {
            return;
        }

        for pid in projects {
            if let Ok(pool) = db.get_project_pool(&pid) {
                if let Ok(conn) = pool.get() {
                    let mut query = "SELECT e.id, e.timestamp, e.event_type, e.os, e.browser, e.region, COALESCE(e.title, i.title), e.ip_address \
                                     FROM events e LEFT JOIN issues i ON e.issue_id = i.id WHERE 1=1".to_string();
                    let mut sql_params: Vec<String> = Vec::new();

                    if let Some(et) = &params.event_type {
                        if !et.is_empty() {
                            query.push_str(" AND e.event_type = ?");
                            sql_params.push(et.clone());
                        }
                    }
                    if let Some(os) = &params.os {
                        if !os.is_empty() {
                            query.push_str(" AND e.os = ?");
                            sql_params.push(os.clone());
                        }
                    }
                    if let Some(br) = &params.browser {
                        if !br.is_empty() {
                            query.push_str(" AND e.browser = ?");
                            sql_params.push(br.clone());
                        }
                    }
                    if let Some(s) = &params.search {
                        if !s.is_empty() {
                            query.push_str(" AND (i.title LIKE ? OR e.title LIKE ? OR e.id LIKE ?)");
                            let search_pattern = format!("%{}%", s);
                            sql_params.push(search_pattern.clone());
                            sql_params.push(search_pattern.clone());
                            sql_params.push(search_pattern);
                        }
                    }

                    query.push_str(" ORDER BY e.timestamp DESC LIMIT 5000");

                    if let Ok(mut stmt) = conn.prepare(&query) {
                        let rows = stmt.query_map(rusqlite::params_from_iter(sql_params), |row| {
                            let title = row.get::<_, Option<String>>(6)?.unwrap_or_default().replace(",", " ").replace("\n", " ");
                            Ok(format!("{},{},{},{},{},{},{},{},{}\n",
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                title,
                                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                                pid.clone()
                            ))
                        });
                        
                        if let Ok(rows) = rows {
                            for row in rows.filter_map(|r| r.ok()) {
                                if tx.blocking_send(Ok(axum::body::Bytes::from(row))).is_err() {
                                    return; // receiver dropped
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    let body = axum::body::Body::from_stream(ReceiverStream { rx });

    let headers = [
        (axum::http::header::CONTENT_TYPE, "text/csv".to_string()),
        (axum::http::header::CONTENT_DISPOSITION, "attachment; filename=\"explorer_export.csv\"".to_string()),
    ];

    Ok((headers, body))
}

// DELETE /api/projects/:project_id/events/:event_id
pub async fn delete_event(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, event_id)): AxumPath<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let affected = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            // Find issue_id for this event first, to check if we should update issue count or delete the issue if it has 0 events left!
            let issue_id: Option<String> = conn.query_row(
                "SELECT issue_id FROM events WHERE id = ?1",
                [&event_id],
                |row| row.get(0)
            ).ok();

            if conn.execute("DELETE FROM events WHERE id = ?1", rusqlite::params![&event_id]).unwrap_or(0) > 0 {
                if let Some(iid) = issue_id {
                    // Update issue counts
                    let count: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM events WHERE issue_id = ?1",
                        [&iid],
                        |row| row.get(0)
                    ).unwrap_or(0);

                    if count == 0 {
                        // Delete issue if there are no more events left
                        let _ = conn.execute("DELETE FROM issues WHERE id = ?1", rusqlite::params![&iid]);
                    } else {
                        // Update the count and users_affected
                        let users_affected: i64 = conn.query_row(
                            "SELECT COUNT(DISTINCT ip_address) FROM events WHERE issue_id = ?1",
                            [&iid],
                            |row| row.get(0)
                        ).unwrap_or(1);

                        let _ = conn.execute(
                            "UPDATE issues SET count = ?1, users_affected = ?2 WHERE id = ?3",
                            rusqlite::params![count, users_affected, &iid]
                        );
                    }
                }
                return true;
            }
        }
        false
    }).await.unwrap_or(false);

    if affected {
        state.db_manager.invalidate_dashboard_cache(&project_id).await;
        Ok(Json(json!({ "status": "ok" })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
