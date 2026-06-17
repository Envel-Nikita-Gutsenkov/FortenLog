use axum::{extract::State, http::StatusCode};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

/// DELETE /api/system/api-keys/:id — admin only
pub async fn revoke_api_key(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(key_id): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }

    let db = Arc::clone(&state.db_manager);

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let affected = conn
            .execute(
                "UPDATE api_keys SET is_revoked = 1 WHERE id = ?1",
                [&key_id],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if affected == 0 {
            Err(StatusCode::NOT_FOUND)
        } else {
            Ok(key_id)
        }
    })
    .await;

    match result {
        Ok(Ok(kid)) => {
            crate::handlers::settings_audit::log_audit(
                state.db_manager.clone(),
                &claims.sub,
                "REVOKE_API_KEY",
                &format!("id={}", kid),
            )
            .await;
            StatusCode::OK
        }
        Ok(Err(code)) => code,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
