use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::middleware::api_key::ApiKeyClaims;
use super::{require_scope};

/// GET /v1/system — metadata about this FortenLog instance
pub async fn v1_system_info(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
) -> Result<Json<Value>, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let accessible = claims.project_ids.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let project_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap_or(0);

        let version = env!("CARGO_PKG_VERSION");

        Ok::<_, StatusCode>(json!({
            "version":         version,
            "project_count":   project_count,
            "accessible_projects": accessible,
            "api_version":     "v1",
            "server":          "FortenLog",
        }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects — list projects accessible by this key
pub async fn v1_list_projects(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "stats:read")?;

    let db = Arc::clone(&state.db_manager);
    let accessible = claims.project_ids.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn
            .prepare("SELECT id, name, created_at, retention_days FROM projects ORDER BY name")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let all_access = accessible.iter().any(|p| p == "*");
        let items: Vec<Value> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .filter(|(id, ..)| all_access || accessible.iter().any(|p| p == id))
            .map(|(id, name, created_at, retention_days)| json!({
                "id": id,
                "name": name,
                "created_at": created_at,
                "retention_days": retention_days,
            }))
            .collect();

        Ok::<_, StatusCode>(json!({ "projects": items, "total": items.len() }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
