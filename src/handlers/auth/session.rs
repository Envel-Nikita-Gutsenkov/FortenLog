use axum::{extract::{State, Path}, http::StatusCode, Json};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::login::Claims;

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    let state_clone = state.clone();
    let sub = claims.sub.clone();
    let session_id = claims.session_id.clone();

    let sessions = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in list_sessions: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let mut stmt = conn.prepare(
            "SELECT id, ip, user_agent, last_active, id = ?1 as is_current \
             FROM sessions \
             WHERE username = ?2 AND is_revoked = 0"
        ).map_err(|e| {
            tracing::error!("Database Prepare Statement Error in list_sessions: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let rows = stmt.query_map([session_id, sub], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "ip": row.get::<_, String>(1)?,
                "user_agent": row.get::<_, String>(2)?,
                "last_active": row.get::<_, String>(3)?,
                "is_current": row.get::<_, bool>(4)?
            }))
        }).map_err(|e| {
            tracing::error!("Database Query Map Error in list_sessions: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(val) = r {
                list.push(val);
            }
        }
        Ok(list)
    }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(sessions))
}

pub async fn revoke_session(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let state_clone = state.clone();
    let sub = claims.sub.clone();

    tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in revoke_session: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        conn.execute(
            "UPDATE sessions SET is_revoked = 1 WHERE id = ?1 AND username = ?2",
            [id, sub]
        ).map_err(|e| {
            tracing::error!("Database Update Error in revoke_session: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        Ok(StatusCode::OK)
    }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR))
}
