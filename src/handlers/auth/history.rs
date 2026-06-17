use axum::{extract::{State}, http::StatusCode, Json};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::login::Claims;

pub async fn get_login_history(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    let state_clone = state.clone();
    let sub = claims.sub.clone();

    let history = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in get_login_history: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let mut stmt = conn.prepare(
            "SELECT id, ip, status, user_agent, timestamp \
             FROM login_history \
             WHERE username = ?1 \
             ORDER BY timestamp DESC LIMIT 50"
        ).map_err(|e| {
            tracing::error!("Database Prepare Statement Error in get_login_history: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let rows = stmt.query_map([sub], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "ip": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "user_agent": row.get::<_, String>(3)?,
                "timestamp": row.get::<_, String>(4)?
            }))
        }).map_err(|e| {
            tracing::error!("Database Query Map Error in get_login_history: {:?}", e);
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

    Ok(Json(history))
}
