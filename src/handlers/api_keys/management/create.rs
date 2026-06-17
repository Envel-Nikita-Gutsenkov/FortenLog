use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use super::{CreateApiKeyRequest, hash_key, validate_scopes, validate_ip_or_cidr};

/// POST /api/system/api-keys — admin only
pub async fn create_api_key(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<CreateApiKeyRequest>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let name = payload.name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if !validate_scopes(&payload.scopes) {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    if let Some(ref ips) = payload.allowed_ips {
        if ips.iter().any(|ip| !validate_ip_or_cidr(ip)) {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if let Some(days) = payload.expires_in_days {
        if days < 1 || days > 3650 {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }

    // Validate project_ids actually exist
    let db = Arc::clone(&state.db_manager);
    let project_ids = payload.project_ids.clone();
    let valid_projects = tokio::task::spawn_blocking({
        let db = Arc::clone(&db);
        move || {
            let conn = db.get_system_conn()?;
            let mut ok = true;
            for pid in &project_ids {
                let exists: bool = conn
                    .query_row("SELECT 1 FROM projects WHERE id = ?1", [pid], |_| Ok(true))
                    .unwrap_or(false);
                if !exists {
                    ok = false;
                    break;
                }
            }
            anyhow::Ok(ok)
        }
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !valid_projects {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }

    // Generate raw key: flpat_ + 32 random bytes as hex (256-bit entropy)
    let raw_bytes: [u8; 32] = rand::random();
    let raw_hex: String = raw_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let raw_key = format!("flpat_{}", raw_hex);
    let key_hash = hash_key(&raw_key);
    let key_prefix = format!("flpat_{}", &raw_hex[..8]);

    let expires_at = payload.expires_in_days.map(|days| {
        (chrono::Utc::now() + chrono::Duration::days(days)).to_rfc3339()
    });

    let id = uuid::Uuid::new_v4().to_string();
    let project_ids_json = serde_json::to_string(&payload.project_ids).unwrap_or_else(|_| "[]".into());
    let scopes_json = serde_json::to_string(&payload.scopes).unwrap_or_else(|_| "[]".into());
    let allowed_ips_json = payload
        .allowed_ips
        .as_ref()
        .map(|ips| serde_json::to_string(ips).unwrap_or_default());

    let id_clone = id.clone();
    let key_prefix_clone = key_prefix.clone();
    let owner = claims.sub.clone();

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute(
            "INSERT INTO api_keys
             (id, name, key_hash, key_prefix, owner, project_ids, scopes, allowed_ips, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id_clone,
                name,
                key_hash,
                key_prefix_clone,
                owner,
                project_ids_json,
                scopes_json,
                allowed_ips_json,
                expires_at,
            ],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok::<_, StatusCode>(())
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    crate::handlers::settings_audit::log_audit(
        state.db_manager.clone(),
        &claims.sub,
        "CREATE_API_KEY",
        &format!("name={}, id={}, prefix={}", payload.name.trim(), id, key_prefix),
    )
    .await;

    Ok(Json(json!({
        "id":         id,
        "key":        raw_key,
        "key_prefix": key_prefix,
        "message":    "Store this key securely — it will not be shown again."
    })))
}
