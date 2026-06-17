use axum::{extract::State, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::middleware::api_key::ApiKeyClaims;
use super::{require_scope, check_project_access, clamp_limit};

#[derive(Debug, Deserialize)]
pub struct EventListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub event_type: Option<String>,
    pub environment: Option<String>,
    pub release: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
}

/// GET /v1/projects/:project_id/issues/:issue_id/events
pub async fn v1_get_issue_events(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path((project_id, issue_id)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<EventListParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "events:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let limit = clamp_limit(params.limit);
    let offset = params.offset.unwrap_or(0).max(0);
    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE issue_id = ?1", [&issue_id], |r| r.get(0))
            .unwrap_or(0);

        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp, event_type, os, browser, region, release_version, environment, hwid
                 FROM events WHERE issue_id = ?1 ORDER BY timestamp DESC LIMIT ?2 OFFSET ?3",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let items: Vec<Value> = stmt
            .query_map(rusqlite::params![issue_id, limit, offset], |row| {
                Ok(json!({
                    "id":              row.get::<_, String>(0)?,
                    "timestamp":       row.get::<_, String>(1)?,
                    "event_type":      row.get::<_, Option<String>>(2)?,
                    "os":              row.get::<_, Option<String>>(3)?,
                    "browser":         row.get::<_, Option<String>>(4)?,
                    "region":          row.get::<_, Option<String>>(5)?,
                    "release_version": row.get::<_, Option<String>>(6)?,
                    "environment":     row.get::<_, Option<String>>(7)?,
                    "hwid":            row.get::<_, Option<String>>(8)?,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        Ok::<_, StatusCode>(json!({ "total": total, "limit": limit, "offset": offset, "items": items }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/issues/:issue_id/events/:event_id
pub async fn v1_get_event_detail(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path((project_id, _issue_id, event_id)): axum::extract::Path<(String, String, String)>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "events:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.query_row(
            "SELECT e.id, e.issue_id, e.timestamp, e.event_type, e.hwid, e.ip_address,
                    e.os, e.browser, e.region, e.release_version, e.environment, e.title,
                    p.data, p.size_original, p.size_compressed
             FROM events e LEFT JOIN payloads p ON e.payload_hash = p.hash
             WHERE e.id = ?1",
            [&event_id],
            |row| {
                let payload_bytes: Option<Vec<u8>> = row.get(12).ok();
                let size_original: Option<i64> = row.get(13).ok();
                let size_compressed: Option<i64> = row.get(14).ok();

                let mut event_obj = json!({
                    "id":              row.get::<_, String>(0)?,
                    "issue_id":        row.get::<_, Option<String>>(1)?,
                    "timestamp":       row.get::<_, String>(2)?,
                    "event_type":      row.get::<_, Option<String>>(3)?,
                    "hwid":            row.get::<_, Option<String>>(4)?,
                    "ip_address":      row.get::<_, Option<String>>(5)?,
                    "os":              row.get::<_, Option<String>>(6)?,
                    "browser":         row.get::<_, Option<String>>(7)?,
                    "region":          row.get::<_, Option<String>>(8)?,
                    "release_version": row.get::<_, Option<String>>(9)?,
                    "environment":     row.get::<_, Option<String>>(10)?,
                    "title":           row.get::<_, Option<String>>(11)?,
                    "payload_size_original":   size_original,
                    "payload_size_compressed": size_compressed,
                    "project_id":      project_id.clone(),
                });

                if let Some(bytes) = payload_bytes {
                    let decompressed = zstd::stream::decode_all(&bytes[..]).unwrap_or(bytes);
                    if let Ok(text) = std::str::from_utf8(&decompressed) {
                        let mut payload_lines = Vec::new();
                        for line in text.lines() {
                            if let Ok(parsed) = serde_json::from_str::<Value>(line) {
                                payload_lines.push(parsed);
                            }
                        }
                        if let Some(obj) = event_obj.as_object_mut() {
                            obj.insert("payload".into(), json!(payload_lines));
                        }
                    }
                }

                Ok(event_obj)
            },
        )
        .map_err(|_| StatusCode::NOT_FOUND)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/events
pub async fn v1_list_events(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<EventListParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "events:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let limit = clamp_limit(params.limit);
    let offset = params.offset.unwrap_or(0).max(0);
    let type_filter = params.event_type.clone();
    let env_filter = params.environment.clone();
    let release_filter = params.release.clone();
    let since_filter = params.since.clone();
    let until_filter = params.until.clone();

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut where_parts = Vec::new();
        let mut bind_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref v) = type_filter {
            where_parts.push("event_type = ?");
            bind_params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = env_filter {
            where_parts.push("environment = ?");
            bind_params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = release_filter {
            where_parts.push("release_version = ?");
            bind_params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = since_filter {
            where_parts.push("timestamp >= ?");
            bind_params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = until_filter {
            where_parts.push("timestamp <= ?");
            bind_params.push(Box::new(v.clone()));
        }

        let where_sql = if where_parts.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_parts.join(" AND "))
        };

        let count_refs: Vec<&dyn rusqlite::ToSql> = bind_params.iter().map(|p| p.as_ref()).collect();
        let total: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM events {}", where_sql), count_refs.as_slice(), |r| r.get(0))
            .unwrap_or(0);

        let mut list_params = bind_params;
        list_params.push(Box::new(limit));
        list_params.push(Box::new(offset));
        let list_refs: Vec<&dyn rusqlite::ToSql> = list_params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn
            .prepare(&format!(
                "SELECT id, issue_id, timestamp, event_type, os, browser, region, release_version, environment, hwid
                 FROM events {} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                where_sql
            ))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let items: Vec<Value> = stmt
            .query_map(list_refs.as_slice(), |row| {
                Ok(json!({
                    "id":              row.get::<_, String>(0)?,
                    "issue_id":        row.get::<_, Option<String>>(1)?,
                    "timestamp":       row.get::<_, String>(2)?,
                    "event_type":      row.get::<_, Option<String>>(3)?,
                    "os":              row.get::<_, Option<String>>(4)?,
                    "browser":         row.get::<_, Option<String>>(5)?,
                    "region":          row.get::<_, Option<String>>(6)?,
                    "release_version": row.get::<_, Option<String>>(7)?,
                    "environment":     row.get::<_, Option<String>>(8)?,
                    "hwid":            row.get::<_, Option<String>>(9)?,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        Ok::<_, StatusCode>(json!({ "total": total, "limit": limit, "offset": offset, "items": items }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
