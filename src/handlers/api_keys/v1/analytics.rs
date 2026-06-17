use axum::{extract::State, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::middleware::api_key::ApiKeyClaims;
use super::{require_scope, check_project_access, clamp_limit};
use super::events::EventListParams;

#[derive(Debug, Deserialize)]
pub struct AnalyticsParams {
    pub since: Option<String>,
    pub until: Option<String>,
    pub granularity: Option<String>,
}

/// GET /v1/projects/:project_id/stats
pub async fn v1_get_stats(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "stats:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let total_events: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap_or(0);
        let total_issues: i64 = conn.query_row("SELECT COUNT(*) FROM issues", [], |r| r.get(0)).unwrap_or(0);
        let open_issues: i64 = conn.query_row("SELECT COUNT(*) FROM issues WHERE status = 'unhandled'", [], |r| r.get(0)).unwrap_or(0);
        let resolved_issues: i64 = conn.query_row("SELECT COUNT(*) FROM issues WHERE status = 'resolved'", [], |r| r.get(0)).unwrap_or(0);
        let suppressed_issues: i64 = conn.query_row("SELECT COUNT(*) FROM issues WHERE is_suppressed = 1", [], |r| r.get(0)).unwrap_or(0);
        let events_24h: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE timestamp >= datetime('now','-1 day')", [], |r| r.get(0)).unwrap_or(0);
        let events_7d: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE timestamp >= datetime('now','-7 days')", [], |r| r.get(0)).unwrap_or(0);
        let events_30d: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE timestamp >= datetime('now','-30 days')", [], |r| r.get(0)).unwrap_or(0);
        let total_sessions: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap_or(0);
        let error_sessions: i64 = conn.query_row("SELECT COUNT(*) FROM sessions WHERE is_error = 1", [], |r| r.get(0)).unwrap_or(0);
        let sessions_24h: i64 = conn.query_row("SELECT COUNT(*) FROM sessions WHERE timestamp >= datetime('now','-1 day')", [], |r| r.get(0)).unwrap_or(0);

        let crash_free = if total_sessions > 0 {
            ((total_sessions - error_sessions) as f64 / total_sessions as f64 * 100.0 * 100.0).round() / 100.0
        } else {
            100.0
        };

        // Top OS breakdown
        let mut os_stmt = conn.prepare(
            "SELECT os, COUNT(*) as c FROM events WHERE os IS NOT NULL GROUP BY os ORDER BY c DESC LIMIT 10"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let top_os: Vec<Value> = os_stmt
            .query_map([], |row| Ok(json!({ "os": row.get::<_,String>(0)?, "count": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        // Top browser breakdown
        let mut br_stmt = conn.prepare(
            "SELECT browser, COUNT(*) as c FROM events WHERE browser IS NOT NULL GROUP BY browser ORDER BY c DESC LIMIT 10"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let top_browser: Vec<Value> = br_stmt
            .query_map([], |row| Ok(json!({ "browser": row.get::<_,String>(0)?, "count": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        // Top release breakdown
        let mut rel_stmt = conn.prepare(
            "SELECT release_version, COUNT(*) as c FROM events WHERE release_version IS NOT NULL GROUP BY release_version ORDER BY c DESC LIMIT 10"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let top_releases: Vec<Value> = rel_stmt
            .query_map([], |row| Ok(json!({ "release": row.get::<_,String>(0)?, "count": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        // Top environments
        let mut env_stmt = conn.prepare(
            "SELECT environment, COUNT(*) as c FROM events WHERE environment IS NOT NULL GROUP BY environment ORDER BY c DESC LIMIT 10"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let top_envs: Vec<Value> = env_stmt
            .query_map([], |row| Ok(json!({ "environment": row.get::<_,String>(0)?, "count": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        Ok::<_, StatusCode>(json!({
            "project_id":       project_id,
            "total_events":     total_events,
            "total_issues":     total_issues,
            "open_issues":      open_issues,
            "resolved_issues":  resolved_issues,
            "suppressed_issues": suppressed_issues,
            "events_last_24h":  events_24h,
            "events_last_7d":   events_7d,
            "events_last_30d":  events_30d,
            "total_sessions":   total_sessions,
            "sessions_last_24h": sessions_24h,
            "error_sessions":   error_sessions,
            "crash_free_rate":  crash_free,
            "breakdown": {
                "os":          top_os,
                "browser":     top_browser,
                "release":     top_releases,
                "environment": top_envs,
            }
        }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/analytics
/// PostHog-style analytics rollups with optional time-series bucketing
pub async fn v1_get_analytics(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<AnalyticsParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "stats:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    // granularity: day (default), week, month
    let date_fmt = match params.granularity.as_deref() {
        Some("week")  => "%Y-W%W",
        Some("month") => "%Y-%m",
        _             => "%Y-%m-%d",
    };
    let since = params.since.clone();
    let until = params.until.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut where_parts = Vec::new();
        let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(ref s) = since  { where_parts.push("timestamp >= ?"); bind.push(Box::new(s.clone())); }
        if let Some(ref u) = until  { where_parts.push("timestamp <= ?"); bind.push(Box::new(u.clone())); }
        let where_sql = if where_parts.is_empty() { String::new() } else { format!("WHERE {}", where_parts.join(" AND ")) };

        // Events per day/week/month
        let ts_sql = format!(
            "SELECT strftime('{}', timestamp) as bucket, COUNT(*) as count FROM events {} GROUP BY bucket ORDER BY bucket",
            date_fmt, where_sql
        );
        let refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&ts_sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let timeseries: Vec<Value> = stmt
            .query_map(refs.as_slice(), |row| Ok(json!({ "date": row.get::<_,String>(0)?, "events": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        // Issues per day
        let ts_issues_sql = format!(
            "SELECT strftime('{}', first_seen) as bucket, COUNT(*) as count FROM issues {} GROUP BY bucket ORDER BY bucket",
            date_fmt, where_sql.replace("timestamp", "first_seen")
        );
        let refs2: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|p| p.as_ref()).collect();
        let mut stmt2 = conn.prepare(&ts_issues_sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let issues_ts: Vec<Value> = stmt2
            .query_map(refs2.as_slice(), |row| Ok(json!({ "date": row.get::<_,String>(0)?, "new_issues": row.get::<_,i64>(1)? })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        // Analytics rollups summary
        let mut ar_stmt = conn.prepare(
            "SELECT event_name, SUM(count) as total, COUNT(DISTINCT date_bucket) as days_seen
             FROM analytics_rollups GROUP BY event_name ORDER BY total DESC LIMIT 50"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rollups: Vec<Value> = ar_stmt
            .query_map([], |row| Ok(json!({
                "event_name": row.get::<_,String>(0)?,
                "total_count": row.get::<_,i64>(1)?,
                "days_seen": row.get::<_,i64>(2)?,
            })))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten().collect();

        Ok::<_, StatusCode>(json!({
            "project_id":    project_id,
            "granularity":   date_fmt.replace('%', ""),
            "events_timeseries":  timeseries,
            "issues_timeseries":  issues_ts,
            "event_rollups": rollups,
        }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/sessions
pub async fn v1_get_sessions(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<EventListParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "stats:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let limit = clamp_limit(params.limit);
    let offset = params.offset.unwrap_or(0).max(0);
    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let total: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap_or(0);
        let crash_count: i64 = conn.query_row("SELECT COUNT(*) FROM sessions WHERE is_error = 1", [], |r| r.get(0)).unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT id, hwid, release_version, environment, timestamp, is_error
             FROM sessions ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let items: Vec<Value> = stmt
            .query_map(rusqlite::params![limit, offset], |row| {
                Ok(json!({
                    "id":              row.get::<_, String>(0)?,
                    "hwid":            row.get::<_, Option<String>>(1)?,
                    "release_version": row.get::<_, Option<String>>(2)?,
                    "environment":     row.get::<_, Option<String>>(3)?,
                    "timestamp":       row.get::<_, String>(4)?,
                    "is_error":        row.get::<_, i32>(5)? == 1,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        let crash_free = if total > 0 {
            ((total - crash_count) as f64 / total as f64 * 100.0 * 100.0).round() / 100.0
        } else { 100.0 };

        Ok::<_, StatusCode>(json!({
            "total":          total,
            "crash_count":    crash_count,
            "crash_free_rate": crash_free,
            "limit":          limit,
            "offset":         offset,
            "items":          items,
        }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
