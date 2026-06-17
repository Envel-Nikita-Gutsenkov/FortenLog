use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

/// GET /api/system/api-keys — admin only
pub async fn list_api_keys(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let db = Arc::clone(&state.db_manager);

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, key_prefix, owner, project_ids, scopes, allowed_ips,
                        expires_at, last_used_at, created_at, is_revoked
                 FROM api_keys ORDER BY created_at DESC",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let now = chrono::Utc::now().to_rfc3339();
        let rows = stmt
            .query_map([], |row| {
                let is_revoked: i32 = row.get(10)?;
                let expires_at: Option<String> = row.get(7)?;

                let status = if is_revoked == 1 {
                    "revoked"
                } else if expires_at.as_deref().map(|e| e < now.as_str()).unwrap_or(false) {
                    "expired"
                } else {
                    "active"
                };

                Ok(json!({
                    "id":          row.get::<_, String>(0)?,
                    "name":        row.get::<_, String>(1)?,
                    "key_prefix":  row.get::<_, String>(2)?,
                    "owner":       row.get::<_, String>(3)?,
                    "project_ids": serde_json::from_str::<Value>(
                        &row.get::<_, String>(4).unwrap_or_else(|_| "[]".into())
                    ).unwrap_or(json!([])),
                    "scopes": serde_json::from_str::<Value>(
                        &row.get::<_, String>(5).unwrap_or_else(|_| "[]".into())
                    ).unwrap_or(json!([])),
                    "allowed_ips": row.get::<_, Option<String>>(6)?
                        .and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                    "expires_at":   expires_at,
                    "last_used_at": row.get::<_, Option<String>>(8)?,
                    "created_at":   row.get::<_, String>(9)?,
                    "status":       status,
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut list = Vec::new();
        for row in rows.flatten() {
            list.push(row);
        }
        Ok::<_, StatusCode>(list)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
