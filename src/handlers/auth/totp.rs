use axum::{extract::{State}, http::StatusCode, Json};
use serde::{Deserialize};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::login::Claims;
use totp_rs::{Algorithm, TOTP};

#[derive(Deserialize)]
pub struct Verify2FARequest {
    pub token: String,
    pub secret: String,
}

pub async fn setup_2fa(
    State(_state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    let mut secret = [0u8; 20];
    let u1 = uuid::Uuid::new_v4();
    let u2 = uuid::Uuid::new_v4();
    secret[0..16].copy_from_slice(u1.as_bytes());
    secret[16..20].copy_from_slice(&u2.as_bytes()[0..4]);
    let secret_b32 = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &secret);
    
    Ok(Json(json!({
        "secret": secret_b32,
        "uri": format!("otpauth://totp/FortenLog:{}?secret={}&issuer=FortenLog", claims.sub, secret_b32)
    })))
}

pub async fn verify_2fa(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<Verify2FARequest>,
) -> Result<StatusCode, StatusCode> {
    let secret_bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, &payload.secret)
        .ok_or(StatusCode::BAD_REQUEST)?;

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
    ).map_err(|e| {
        tracing::error!("TOTP Initialization Error: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if totp.check_current(&payload.token).unwrap_or(false) {
        let state_clone = state.clone();
        let sub = claims.sub.clone();
        let secret = payload.secret.clone();

        tokio::task::spawn_blocking(move || {
            let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
                tracing::error!("Database Connection Error in verify_2fa: {:?}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

            conn.execute(
                "UPDATE users SET totp_secret = ?1, totp_enabled = 1 WHERE username = ?2",
                [secret, sub],
            ).map_err(|e| {
                tracing::error!("Database Update Error in verify_2fa: {:?}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

            Ok(StatusCode::OK)
        }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR))
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}
