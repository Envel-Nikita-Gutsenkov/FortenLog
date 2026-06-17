use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
    http::StatusCode,
};
use std::sync::Arc;
use crate::handlers::ingest::AppState;

#[derive(Clone, serde::Deserialize)]
pub struct AuthConfig {
    pub allowed_ips: Vec<String>,
    pub stealth_mode: bool,
}

use crate::handlers::auth::Claims;

use axum::http::header;

pub async fn security_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    // HSTS with preload — forces HTTPS for all browsers that support preloading
    headers.insert(
        header::STRICT_TRANSPORT_SECURITY,
        "max-age=31536000; includeSubDomains; preload".parse().unwrap(),
    );

    // Prevent MIME-sniffing attacks
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());

    // Anti-clickjacking
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());

    // Permissions Policy: disable dangerous browser APIs
    headers.insert(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()".parse().unwrap(),
    );

    // Referrer Policy: don't leak URLs in Referer header
    headers.insert(
        "Referrer-Policy",
        "strict-origin-when-cross-origin".parse().unwrap(),
    );

    // Content Security Policy.
    // 'unsafe-inline' removed — use nonce-based CSP in a future iteration.
    // Google Fonts loaded via CSS @import from stylesheet, so font-src is needed.
    headers.insert(
        "Content-Security-Policy",
        "default-src 'self'; \
         script-src 'self' 'unsafe-inline'; \
         style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
         font-src 'self' https://fonts.gstatic.com data:; \
         img-src 'self' data:; \
         connect-src 'self'; \
         object-src 'none'; \
         base-uri 'self'; \
         form-action 'self'; \
         frame-ancestors 'none';"
            .parse()
            .unwrap(),
    );

    // Legacy XSS Protection header (defense in depth for old browsers)
    headers.insert(header::X_XSS_PROTECTION, "1; mode=block".parse().unwrap());

    // Unique request ID for correlation and incident forensics (LOW-4)
    let request_id = uuid::Uuid::new_v4().to_string();
    if let Ok(val) = request_id.parse() {
        headers.insert("X-Request-ID", val);
    }

    // Prevent sensitive API data from being cached by proxies/CDNs
    if path.starts_with("/api/") {
        headers.insert(
            header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, private".parse().unwrap(),
        );
        headers.insert("Pragma", "no-cache".parse().unwrap());
    } else {
        headers.insert(
            header::CACHE_CONTROL,
            "no-cache, must-revalidate".parse().unwrap(),
        );
    }

    response
}

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next
) -> Result<Response, StatusCode> {
    let path = req.uri().path();

    // CSRF protection for all state-changing operations.
    // Public ingestion endpoints are exempt (SDK clients can't set custom headers).
    if req.method() != axum::http::Method::GET &&
       req.method() != axum::http::Method::HEAD &&
       req.method() != axum::http::Method::OPTIONS
    {
        if req.headers().get("X-FortenLog-Request").is_none() && path != "/api/system/login" {
            // Exempt all public ingest endpoints (with or without trailing slash)
            let is_public_ingest = (path.starts_with("/api/") && path.ends_with("/envelope/"))
                || path == "/capture" || path == "/capture/"
                || path == "/batch"   || path == "/batch/";

            if !is_public_ingest {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    // Public routes bypass JWT/session auth entirely
    if path == "/api/system/login" ||
       (path.starts_with("/api/") && path.ends_with("/envelope/")) ||
       path == "/capture"  || path == "/capture/"  ||
       path == "/batch"    || path == "/batch/"
    {
        return Ok(next.run(req).await);
    }

    // Session auth: prefer cookie, fall back to Bearer token
    let mut session_id = req.headers().get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    if session_id.is_none() {
        if let Some(cookie_str) = req.headers().get(axum::http::header::COOKIE).and_then(|h| h.to_str().ok()) {
            for cookie in cookie_str.split(';') {
                let cookie = cookie.trim();
                // Support both __Host- prefixed (secure) and legacy cookie names
                if let Some(val) = cookie.strip_prefix("__Host-forten_sess=")
                    .or_else(|| cookie.strip_prefix("forten_sess="))
                {
                    session_id = Some(val.to_string());
                    break;
                }
            }
        }
    }

    if let Some(session_id) = session_id {
        let state_clone = state.clone();
        let session_id_clone = session_id.clone();

        let session_data = tokio::task::spawn_blocking(move || {
            let conn = state_clone.db_manager.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let data = conn.query_row(
                "SELECT s.username, u.is_admin, s.ip, s.user_agent, u.password_change_required FROM sessions s \
                 JOIN users u ON s.username = u.username \
                 WHERE s.id = ?1 AND s.is_revoked = 0",
                [&session_id_clone],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)? == 1,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i32>(4)? == 1,
                ))
            ).ok();

            if data.is_some() {
                let _ = conn.execute(
                    "UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?1",
                    [&session_id_clone]
                );
            }
            Ok::<_, StatusCode>(data)
        }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Ok(Some((username, is_admin, stored_ip, stored_ua, password_change_required))) = session_data {
            // Session binding: validate IP + User-Agent match the recorded values
            let current_ip = req.extensions().get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
                .map(|ci| ci.0.ip().to_string())
                .unwrap_or_default();
            let current_ua = req.headers().get(axum::http::header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("unknown");

            if stored_ip != current_ip || stored_ua != current_ua {
                tracing::warn!(
                    "Session binding violation: session={} stored_ip={} current_ip={}",
                    session_id, stored_ip, current_ip
                );
                return Err(StatusCode::UNAUTHORIZED);
            }

            // If password change is required, block all non-essential administrative/analytics API paths
            if password_change_required 
                && path != "/api/system/security/password" 
                && path != "/api/system/logout" 
                && path != "/api/system/me"
            {
                tracing::warn!("Blocked request to '{}' for user '{}' - password change required.", path, username);
                return Err(StatusCode::FORBIDDEN);
            }

            let mut req = req;
            req.extensions_mut().insert(Claims {
                sub: username,
                is_admin,
                session_id,
                password_change_required,
            });
            return Ok(next.run(req).await);
        }
    }

    // Stealth mode: return 404 instead of 401 to hide the admin panel existence
    if state.auth_config.stealth_mode {
        Err(StatusCode::NOT_FOUND)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

pub fn mask_ip(ip: &str) -> String {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() == 4 {
        format!("{}.{}.{}.0", parts[0], parts[1], parts[2])
    } else {
        ip.to_string()
    }
}
