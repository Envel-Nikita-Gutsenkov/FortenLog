use axum::{extract::{State, Query}, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use super::overview::DashboardParams;

pub async fn list_dashboards(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::handlers::auth::Claims>,
    Query(params): Query<DashboardParams>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let project_id = params.project_id.unwrap_or_else(|| "all".to_string());

    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    
    let dashboards = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn.prepare("SELECT id, name, config, created_at, project_id FROM dashboards WHERE username = ?1 AND (project_id = ?2 OR project_id IS NULL OR ?2 = 'all')").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map([username, project_id], |row: &rusqlite::Row| {
            let config_str = row.get::<_, String>(2)?;
            let config = serde_json::from_str::<Value>(&config_str).unwrap_or_else(|e| {
                tracing::warn!("Failed to parse dashboard config JSON for row: {:?}. Error: {:?}", config_str, e);
                json!([])
            });
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "config": config,
                "created_at": row.get::<_, String>(3)?,
                "project_id": row.get::<_, Option<String>>(4)?,
            }))
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(d) = row { result.push(d); }
        }
        Ok::<Vec<Value>, StatusCode>(result)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(dashboards))
}

pub async fn save_dashboard(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::handlers::auth::Claims>,
    Json(payload): Json<Value>,
) -> Result<StatusCode, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let id = payload["id"].as_str().map(|s| s.to_string()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let name = payload["name"].as_str().unwrap_or("Untitled Dashboard").to_string();
    let config = serde_json::to_string(&payload["config"]).unwrap_or_else(|_| "[]".to_string());
    let project_id = payload["project_id"].as_str().map(|s| s.to_string());

    if let Some(ref pid) = project_id {
        if !crate::handlers::auth::check_project_access(&state, &claims, pid).await {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute(
            "INSERT OR REPLACE INTO dashboards (id, username, name, config, project_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&id, &username, &name, &config, &project_id]
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok::<StatusCode, StatusCode>(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

pub async fn delete_dashboard(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::handlers::auth::Claims>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("DELETE FROM dashboards WHERE id = ?1 AND username = ?2", [&id, &username]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok::<StatusCode, StatusCode>(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}
