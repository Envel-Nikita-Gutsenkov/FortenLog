use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
    http::StatusCode,
};
use std::sync::Arc;
use sha2::{Digest, Sha256};

use crate::handlers::ingest::AppState;

/// Claims injected into request extensions for API-key authenticated routes.
#[derive(Clone, Debug)]
pub struct ApiKeyClaims {
    pub key_id: String,
    pub owner: String,
    pub project_ids: Vec<String>,
    pub scopes: Vec<String>,
}

/// Checks whether the client IP matches any entry in the allowlist.
/// Supports plain IPs and CIDR notation (IPv4 only for CIDR).
fn ip_allowed(client_ip: &str, allowlist: &[String]) -> bool {
    if allowlist.is_empty() {
        return true;
    }
    let client_ip_addr = client_ip.parse::<std::net::IpAddr>();

    for entry in allowlist {
        if entry == client_ip {
            return true;
        }
        if let Some((net_addr, prefix_len)) = entry.split_once('/') {
            if let (Ok(ref client_addr), Ok(net), Ok(bits)) = (
                &client_ip_addr,
                net_addr.parse::<std::net::IpAddr>(),
                prefix_len.parse::<u32>(),
            ) {
                match (client_addr, net) {
                    (std::net::IpAddr::V4(c), std::net::IpAddr::V4(n)) => {
                        if bits == 0 { return true; }
                        let mask = u32::MAX << (32 - bits.min(32));
                        if (u32::from(*c) & mask) == (u32::from(n) & mask) {
                            return true;
                        }
                    }
                    (std::net::IpAddr::V6(c), std::net::IpAddr::V6(n)) => {
                        if bits == 0 { return true; }
                        let mask = u128::MAX << (128 - bits.min(128));
                        if (u128::from(*c) & mask) == (u128::from(n) & mask) {
                            return true;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    false
}

pub async fn api_key_auth_middleware(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Extract Bearer token from Authorization header
    let raw_key = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string());

    let raw_key = match raw_key {
        Some(k) if k.starts_with("flpat_") && k.len() == 70 => k,
        _ => return Err(StatusCode::UNAUTHORIZED),
    };

    // Compute hash — constant-time-safe since attacker can't observe timing from hash comparison
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = format!("{:x}", hasher.finalize());

    // Rate-limit by key prefix (first 14 chars = "flpat_" + 8 hex)
    let key_prefix = &raw_key[..14];
    let rate_key = format!("apikey:{}", key_prefix);
    let count = state
        .api_key_rate_limit
        .get(&rate_key)
        .await
        .unwrap_or(0u32);

    if count >= 120 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    state
        .api_key_rate_limit
        .insert(rate_key.clone(), count + 1)
        .await;

    // Extract client IP
    let client_ip = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_default();

    // Lookup key in DB
    let db = Arc::clone(&state.db_manager);
    let now = chrono::Utc::now().to_rfc3339();

    let claims = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let row = conn.query_row(
            "SELECT id, owner, project_ids, scopes, allowed_ips, expires_at, is_revoked
             FROM api_keys WHERE key_hash = ?1",
            [&key_hash],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i32>(6)?,
                ))
            },
        );

        let (key_id, owner, project_ids_json, scopes_json, allowed_ips_json, expires_at, is_revoked) =
            row.map_err(|_| StatusCode::UNAUTHORIZED)?;

        if is_revoked == 1 {
            return Err(StatusCode::UNAUTHORIZED);
        }

        if let Some(ref exp) = expires_at {
            if exp.as_str() < now.as_str() {
                return Err(StatusCode::UNAUTHORIZED);
            }
        }

        // IP allowlist check
        if let Some(ref ips_json) = allowed_ips_json {
            let allowlist: Vec<String> = serde_json::from_str(ips_json).unwrap_or_default();
            if !allowlist.is_empty() && !ip_allowed(&client_ip, &allowlist) {
                return Err(StatusCode::FORBIDDEN);
            }
        }

        let project_ids: Vec<String> = serde_json::from_str(&project_ids_json).unwrap_or_default();
        let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();

        // Update last_used_at asynchronously (fire-and-forget, failure is non-critical)
        let _ = conn.execute(
            "UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2",
            rusqlite::params![now, key_id],
        );

        Ok::<_, StatusCode>(ApiKeyClaims { key_id, owner, project_ids, scopes })
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
