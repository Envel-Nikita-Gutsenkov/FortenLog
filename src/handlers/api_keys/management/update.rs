use axum::{extract::State, Json, http::StatusCode};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use super::{UpdateApiKeyRequest, validate_ip_or_cidr};

/// PUT /api/system/api-keys/:id — admin only (update name / ip allowlist / expiry)
pub async fn update_api_key(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(key_id): axum::extract::Path<String>,
    Json(payload): Json<UpdateApiKeyRequest>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    if let Some(ref ips) = payload.allowed_ips {
        if ips.iter().any(|ip| !validate_ip_or_cidr(ip)) {
            return StatusCode::UNPROCESSABLE_ENTITY;
        }
    }

    let db = Arc::clone(&state.db_manager);

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let exists: bool = conn
            .query_row("SELECT 1 FROM api_keys WHERE id = ?1", [&key_id], |_| Ok(true))
            .unwrap_or(false);
        if !exists {
            return Err(StatusCode::NOT_FOUND);
        }

        if let Some(ref name) = payload.name {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                let _ = conn.execute(
                    "UPDATE api_keys SET name = ?1 WHERE id = ?2",
                    rusqlite::params![trimmed, key_id],
                );
            }
        }
        if let Some(ref ips) = payload.allowed_ips {
            let json_str = serde_json::to_string(ips).unwrap_or_default();
            let _ = conn.execute(
                "UPDATE api_keys SET allowed_ips = ?1 WHERE id = ?2",
                rusqlite::params![json_str, key_id],
            );
        }
        if let Some(ref exp) = payload.expires_at {
            let _ = conn.execute(
                "UPDATE api_keys SET expires_at = ?1 WHERE id = ?2",
                rusqlite::params![exp, key_id],
            );
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => StatusCode::OK,
        Ok(Err(code)) => code,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
