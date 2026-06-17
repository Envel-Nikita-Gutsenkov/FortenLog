use axum::{extract::{State}, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::login::Claims;
use uuid::Uuid;
use base64::Engine;

fn is_mock_allowed() -> bool {
    std::env::var("FORTENLOG_ALLOW_MOCK_WEBAUTHN")
        .map(|v| v == "true")
        .unwrap_or(false)
}

pub async fn webauthn_register_start(
    State(_state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !is_mock_allowed() {
        return Err(StatusCode::FORBIDDEN);
    }
    // Simulate start_passkey_registration
    let user_unique_id = Uuid::new_v4();
    
    Ok(Json(json!({
        "publicKey": {
            "rp": { "name": "FortenLog", "id": "localhost" },
            "user": {
                "id": base64::engine::general_purpose::STANDARD.encode(user_unique_id.as_bytes()),
                "name": claims.sub,
                "displayName": claims.sub
            },
            "challenge": "mock_challenge_123",
            "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
            "timeout": 60000,
            "attestation": "none",
            "excludeCredentials": [],
            "authenticatorSelection": { "userVerification": "preferred" }
        },
        "mock": true
    })))
}

pub async fn webauthn_register_finish(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(reg_response): Json<Value>,
) -> Result<StatusCode, StatusCode> {
    if !is_mock_allowed() {
        return Err(StatusCode::FORBIDDEN);
    }
    let credential_id = reg_response.get("id").and_then(|v| v.as_str()).unwrap_or("mock_cred_id").to_string();
    let credential_data = json!({
        "cred_id": credential_id,
        "type": "public-key",
        "mocked": true
    }).to_string();
    
    let state_clone = state.clone();
    let sub_clone = claims.sub.clone();

    tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in webauthn_register_finish: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        conn.execute(
            "INSERT INTO webauthn_credentials (id, username, credential_data) VALUES (?1, ?2, ?3)",
            rusqlite::params![credential_id.as_bytes(), sub_clone, credential_data],
        ).map_err(|e| {
            tracing::error!("Database Credential Insertion Error in webauthn_register_finish: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        Ok(StatusCode::OK)
    }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR))
}

#[derive(Deserialize)]
pub struct WebauthnLoginStartRequest {
    pub username: String,
}

pub async fn webauthn_login_start(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<WebauthnLoginStartRequest>,
) -> Result<Json<Value>, StatusCode> {
    if !is_mock_allowed() {
        return Err(StatusCode::FORBIDDEN);
    }
    let state_clone = state.clone();
    let username = payload.username.clone();

    let exists = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in webauthn_login_start: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        let exists: bool = conn.query_row(
            "SELECT 1 FROM webauthn_credentials WHERE username = ?1",
            [&username],
            |_| Ok(true)
        ).unwrap_or(false);
        Ok(exists)
    }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR))?;

    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(json!({
        "publicKey": {
            "challenge": "mock_auth_challenge_123",
            "timeout": 60000,
            "rpId": "localhost",
            "allowCredentials": [],
            "userVerification": "preferred"
        },
        "mock": true
    })))
}

pub async fn webauthn_login_finish(
    State(state): State<Arc<AppState>>,
    client_ctx: crate::handlers::auth::ClientContext,
    headers: axum::http::HeaderMap,
    Json(_auth_response): Json<Value>,
) -> impl IntoResponse {
    if !is_mock_allowed() {
        return (StatusCode::FORBIDDEN, "Mock WebAuthn is disabled").into_response();
    }
    let username = match headers.get("X-Webauthn-Username").and_then(|v| v.to_str().ok()) {
        Some(u) => u.to_string(),
        None => return (StatusCode::BAD_REQUEST, "Missing X-Webauthn-Username header").into_response(),
    };

    let state_clone = state.clone();
    let username_clone = username.clone();
    let ip = client_ctx.ip.clone();
    let user_agent = client_ctx.user_agent.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|e| {
            tracing::error!("Database Connection Error in webauthn_login_finish: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let exists: bool = conn.query_row(
            "SELECT 1 FROM webauthn_credentials WHERE username = ?1",
            [&username_clone],
            |_| Ok(true)
        ).unwrap_or(false);

        if !exists {
            return Err(StatusCode::UNAUTHORIZED);
        }

        let session_id = uuid::Uuid::new_v4().to_string();
        
        conn.execute(
            "INSERT INTO sessions (id, username, ip, user_agent) VALUES (?1, ?2, ?3, ?4)",
            [&session_id, &username_clone, &ip, &user_agent]
        ).map_err(|e| {
            tracing::error!("Database Session Insertion Error in webauthn_login_finish: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        Ok(session_id)
    }).await.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR));

    match result {
        Ok(session_id) => {
            let mut headers = axum::http::HeaderMap::new();
            let cookie = format!("forten_sess={}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400", session_id);
            headers.insert(axum::http::header::SET_COOKIE, cookie.parse().unwrap());

            (StatusCode::OK, headers, Json(json!({ "success": true, "token": session_id }))).into_response()
        }
        Err(status) => {
            let err_msg = if status == StatusCode::UNAUTHORIZED {
                "Webauthn verification failed: No credential found"
            } else {
                "Internal server error"
            };
            (status, err_msg).into_response()
        }
    }
}
