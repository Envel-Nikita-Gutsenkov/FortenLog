use axum::{
    extract::{State, Json},
    response::IntoResponse,
    http::StatusCode,
    Extension,
};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use serde_json::json;
use argon2::PasswordVerifier;

pub async fn get_audit_logs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let conn = state.db_manager.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stmt = conn.prepare("SELECT timestamp, user, action, details FROM audit_logs ORDER BY timestamp DESC LIMIT 100").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let logs: Vec<_> = stmt.query_map([], |row| {
        Ok(json!({
            "timestamp": row.get::<_, String>(0)?,
            "user": row.get::<_, String>(1)?,
            "action": row.get::<_, String>(2)?,
            "details": row.get::<_, String>(3)?,
        }))
    }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.filter_map(|r| r.ok()).collect();

    Ok(Json(logs))
}

use rusqlite::params;
use uuid::Uuid;
use crate::db::DbManager;

pub async fn log_audit(db_manager: Arc<DbManager>, user: &str, action: &str, details: &str) {
    if let Ok(conn) = db_manager.get_system_conn() {
        let _ = conn.execute(
            "INSERT INTO audit_logs (id, user, action, details) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), user, action, details],
        );
    }
}

use serde::Deserialize;

#[derive(Deserialize)]
pub struct ClearAuditRequest {
    pub password: String,
    pub retention_days: i64,
}

pub async fn clear_audit_logs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ClearAuditRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Admin role required".into()));
    }
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let password = payload.password;
    let retention_days = payload.retention_days;

    // Validate retention range for safety
    if ![14, 30, 90, 180, 365].contains(&retention_days) {
        return Err((StatusCode::BAD_REQUEST, "Invalid retention days threshold".into()));
    }

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "DB Error".into()))?;
        let hash: String = conn.query_row("SELECT password_hash FROM users WHERE username = ?1", [&username], |row| row.get(0))
            .map_err(|_| (StatusCode::UNAUTHORIZED, "User not found".into()))?;
        
        let parsed_hash = argon2::PasswordHash::new(&hash).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hash error".into()))?;
        if argon2::Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_err() {
            return Err((StatusCode::UNAUTHORIZED, "Invalid administrative password".into()));
        }

        // Clear audit logs older than retention_days
        conn.execute(
            "DELETE FROM audit_logs WHERE timestamp < datetime('now', '-' || ?1 || ' days')",
            params![retention_days],
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to clear logs".into()))?;

        // Log the clearance event
        let _ = conn.execute(
            "INSERT INTO audit_logs (id, user, action, details) VALUES (?1, ?2, ?3, ?4)",
            params![
                Uuid::new_v4().to_string(),
                &username,
                "PURGE_AUDIT_LOG",
                &format!("Security audit logs older than {} days were purged by the administrator.", retention_days)
            ],
        );

        Ok(StatusCode::OK)
    }).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Runtime error".into()))?
}
