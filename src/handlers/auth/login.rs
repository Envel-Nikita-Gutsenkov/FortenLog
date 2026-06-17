use ax_auth::{extract::{State}, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use crate::security::{get_login_delay, send_security_alert};
use chrono::Utc;
use axum as ax_auth; // Alias to avoid confusion with internal modules

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: Option<String>,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub token: Option<String>,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_change_required: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub is_admin: bool,
    pub session_id: String,
    pub password_change_required: bool,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    client_ctx: crate::handlers::auth::ClientContext,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let ip = client_ctx.ip;
    let user_agent = client_ctx.user_agent;
    
    // Global IP Rate Limit for Login
    {
        let key = format!("login:{}", ip);
        let mut stats = state.ip_rate_limit.get(&key).await.unwrap_or((0, std::time::Instant::now()));
        
        if stats.1.elapsed().as_secs() > 60 {
            stats.0 = 1;
            stats.1 = std::time::Instant::now();
        } else {
            stats.0 += 1;
        }
        
        state.ip_rate_limit.insert(key, stats).await;

        if stats.0 > 10 { 
            return (StatusCode::TOO_MANY_REQUESTS, Json(LoginResponse {
                success: false, token: None, error: Some("Too many login attempts from this IP. Please wait a minute.".to_string()), password_change_required: None
            })).into_response();
        }
    }
    
    let username = payload.username.unwrap_or_else(|| "admin".to_string());
    let password = payload.password;
    let state_clone = state.clone();
    let username_clone = username.clone();
    let ip_clone = ip.clone();
 
    let auth_result = match tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|_| ("Internal Server Error".to_string(), 0u64))?;

        let user_info = conn.query_row(
            "SELECT password_hash, is_admin, failed_attempts, locked_until, password_change_required FROM users WHERE username = ?1",
            [username_clone.clone()],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)? == 1,
                row.get::<_, u32>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i32>(4)? == 1,
            ))
        ).ok();

        if let Some((hash, is_admin, failed_attempts, locked_until, password_change_required)) = user_info {
            // Check account lockout
            if let Some(locked_str) = locked_until {
                if let Ok(locked_time) = chrono::DateTime::parse_from_rfc3339(&locked_str) {
                    if Utc::now() < locked_time {
                        // Account is locked. To prevent timing attacks, perform a dummy verification
                        let dummy = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
                        if let Ok(h) = PasswordHash::new(dummy) {
                            let _ = Argon2::default().verify_password(b"timing-equalizer", &h);
                        }
                        return Err(("Invalid username or password".to_string(), 0u64));
                    }
                }
            }

            let parsed_hash = PasswordHash::new(&hash).map_err(|_| ("Internal Server Error".to_string(), 0u64))?;

            if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok() {
                let _ = conn.execute(
                    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE username = ?1",
                    [username_clone.clone()]
                );

                let session_id = uuid::Uuid::new_v4().to_string();
                let _ = conn.execute(
                    "INSERT INTO sessions (id, username, ip, user_agent) VALUES (?1, ?2, ?3, ?4)",
                    [session_id.clone(), username_clone.clone(), ip_clone.clone(), user_agent.clone()]
                );
                let _ = conn.execute(
                    "INSERT INTO login_history (id, username, ip, status, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)",
                    [uuid::Uuid::new_v4().to_string(), username_clone.clone(), ip_clone.clone(), "success".to_string(), user_agent.clone()]
                );

                Ok((session_id, is_admin, password_change_required))
            } else {
                let new_failed = failed_attempts + 1;
                let delay = get_login_delay(new_failed);
                // Store lockout timestamp in DB for persistence across restarts
                let locked_until_ts = (Utc::now() + delay).to_rfc3339();
                let _ = conn.execute(
                    "UPDATE users SET failed_attempts = ?1, locked_until = ?2 WHERE username = ?3",
                    rusqlite::params![new_failed, locked_until_ts, username_clone.clone()]
                );
                let _ = conn.execute(
                    "INSERT INTO login_history (id, username, ip, status, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)",
                    [uuid::Uuid::new_v4().to_string(), username_clone.clone(), ip_clone.clone(), "fail".to_string(), user_agent.clone()]
                );

                // Pass computed tarpit delay to the async response path
                let delay_ms = delay.num_milliseconds().max(0) as u64;
                Err(("Invalid username or password".to_string(), delay_ms))
            }
        } else {
            // User does not exist — run dummy Argon2 verify to equalize response time (CRIT-3 timing fix)
            let dummy = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
            if let Ok(h) = PasswordHash::new(dummy) {
                let _ = Argon2::default().verify_password(b"timing-equalizer", &h);
            }
            Err(("Invalid username or password".to_string(), 200u64))
        }
    }).await {
        Ok(res) => res,
        Err(_) => Err(("Runtime Error".to_string(), 0u64)),
    };

    match auth_result {
        Ok((session_id, _is_admin, password_change_required)) => {
            tracing::info!("LOGIN_SUCCESS: user={}", username);
            send_security_alert(&username, &ip, "SUCCESSFUL_LOGIN");

            let mut headers = ax_auth::http::HeaderMap::new();
            // __Host- prefix: browser enforces same-host + Path=/ + Secure, prevents subdomain injection
            let cookie = format!("__Host-forten_sess={}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400", session_id);
            headers.insert(ax_auth::http::header::SET_COOKIE, cookie.parse().unwrap());

            (StatusCode::OK, headers, Json(LoginResponse {
                success: true,
                token: Some(session_id),
                error: None,
                password_change_required: Some(password_change_required),
            })).into_response()
        },
        Err((msg, delay_ms)) => {
            // Tarpit: sleep the computed exponential delay BEFORE sending the response.
            // This directly slows down brute-force attempts on the web interface.
            if delay_ms > 0 {
                tracing::warn!("LOGIN_TARPIT: user={} ip={} delay={}ms", username, ip, delay_ms);
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            } else {
                // Minimum 200ms baseline to equalize response times
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            (StatusCode::UNAUTHORIZED, Json(LoginResponse {
                success: false, token: None, error: Some(msg), password_change_required: None
            })).into_response()
        }
    }
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    ax_auth::Extension(claims): ax_auth::Extension<Claims>,
) -> impl IntoResponse {
    if let Ok(conn) = state.db_manager.get_system_conn() {
        let _ = conn.execute(
            "UPDATE sessions SET is_revoked = 1 WHERE id = ?1",
            [&claims.session_id]
        );
    }

    let mut headers = ax_auth::http::HeaderMap::new();
    headers.insert(
        ax_auth::http::header::SET_COOKIE,
        "forten_sess=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0".parse().unwrap()
    );

    (StatusCode::OK, headers, Json(serde_json::json!({"success": true})))
}


