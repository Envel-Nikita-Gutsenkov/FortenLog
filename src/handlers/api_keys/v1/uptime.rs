use axum::{extract::State, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::middleware::api_key::ApiKeyClaims;
use super::{require_scope, check_project_access, clamp_limit};

#[derive(Debug, Deserialize)]
pub struct UptimeLogParams {
    pub limit: Option<i64>,
    pub since: Option<String>,
}

/// GET /v1/projects/:project_id/uptime
pub async fn v1_get_uptime(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "uptime:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let db = Arc::clone(&state.db_manager);

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.name, m.url, m.interval_secs, m.status,
                        (SELECT is_up FROM uptime_logs WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1),
                        (SELECT latency_ms FROM uptime_logs WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1),
                        (SELECT timestamp FROM uptime_logs WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1),
                        (SELECT COUNT(*) FROM uptime_logs WHERE monitor_id = m.id AND is_up = 1
                         AND timestamp >= datetime('now', '-1 day')),
                        (SELECT COUNT(*) FROM uptime_logs WHERE monitor_id = m.id
                         AND timestamp >= datetime('now', '-1 day'))
                 FROM uptime_monitors m WHERE m.project_id = ?1 ORDER BY m.name",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let items: Vec<Value> = stmt
            .query_map([&project_id], |row| {
                let up_24h: i64 = row.get(8).unwrap_or(0);
                let total_24h: i64 = row.get(9).unwrap_or(0);
                let uptime_pct = if total_24h > 0 {
                    (up_24h as f64 / total_24h as f64 * 10000.0).round() / 100.0
                } else { 100.0 };
                Ok(json!({
                    "id":            row.get::<_, String>(0)?,
                    "name":          row.get::<_, String>(1)?,
                    "url":           row.get::<_, String>(2)?,
                    "interval_secs": row.get::<_, i64>(3)?,
                    "status":        row.get::<_, String>(4)?,
                    "is_up":         row.get::<_, Option<i32>>(5)?.map(|v| v == 1),
                    "latency_ms":    row.get::<_, Option<i64>>(6)?,
                    "last_checked":  row.get::<_, Option<String>>(7)?,
                    "uptime_24h_pct": uptime_pct,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        Ok::<_, StatusCode>(json!({ "monitors": items }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/uptime/:monitor_id/logs
pub async fn v1_get_uptime_logs(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path((project_id, monitor_id)): axum::extract::Path<(String, String)>,
    axum::extract::Query(params): axum::extract::Query<UptimeLogParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "uptime:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let limit = clamp_limit(params.limit.or(Some(100)));
    let since = params.since.clone();
    let db = Arc::clone(&state.db_manager);

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Verify monitor belongs to this project
        let belongs: bool = conn
            .query_row(
                "SELECT 1 FROM uptime_monitors WHERE id = ?1 AND project_id = ?2",
                rusqlite::params![monitor_id, project_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !belongs {
            return Err(StatusCode::NOT_FOUND);
        }

        let mut bind: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(monitor_id.clone())];
        let where_extra = if let Some(ref s) = since {
            bind.push(Box::new(s.clone()));
            "AND timestamp >= ?".to_string()
        } else {
            String::new()
        };
        bind.push(Box::new(limit));

        let sql = format!(
            "SELECT timestamp, latency_ms, status_code, is_up
             FROM uptime_logs WHERE monitor_id = ?1 {} ORDER BY timestamp DESC LIMIT ?",
            where_extra
        );

        let refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let logs: Vec<Value> = stmt
            .query_map(refs.as_slice(), |row| {
                Ok(json!({
                    "timestamp":   row.get::<_, String>(0)?,
                    "latency_ms":  row.get::<_, Option<i64>>(1)?,
                    "status_code": row.get::<_, Option<i64>>(2)?,
                    "is_up":       row.get::<_, i32>(3)? == 1,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        let avg_latency: f64 = if logs.is_empty() { 0.0 } else {
            let sum: f64 = logs.iter().filter_map(|l| l["latency_ms"].as_f64()).sum();
            (sum / logs.len() as f64 * 100.0).round() / 100.0
        };
        let up_count = logs.iter().filter(|l| l["is_up"] == true).count();

        Ok::<_, StatusCode>(json!({
            "monitor_id":     monitor_id,
            "total":          logs.len(),
            "up_count":       up_count,
            "down_count":     logs.len() - up_count,
            "avg_latency_ms": avg_latency,
            "logs":           logs,
        }))

    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
