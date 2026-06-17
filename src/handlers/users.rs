use axum::{
    extract::{State, Path},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::security::validate_password_strength;
use crate::handlers::auth::Claims;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};

#[derive(Deserialize)]
pub struct UpdatePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub async fn update_password(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<UpdatePasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let Err(e) = validate_password_strength(&payload.new_password) {
        return Err((StatusCode::BAD_REQUEST, e));
    }
    
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let current_password = payload.current_password;
    let new_password = payload.new_password;

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "DB Error".into()))?;
        let current_hash: String = conn.query_row(
            "SELECT password_hash FROM users WHERE username = ?1",
            [&username],
            |row| row.get(0)
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "User not found".into()))?;

        let parsed_hash = PasswordHash::new(&current_hash).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hash error".into()))?;
        if Argon2::default().verify_password(current_password.as_bytes(), &parsed_hash).is_err() {
            return Err((StatusCode::UNAUTHORIZED, "Invalid current password".into()));
        }

        let salt = argon2::password_hash::SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        let new_hash = Argon2::default()
            .hash_password(new_password.as_bytes(), &salt)
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hashing failed".into()))?
            .to_string();

        conn.execute("UPDATE users SET password_hash = ?1, password_change_required = 0 WHERE username = ?2", [new_hash, username])
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Update failed".into()))?;

        Ok(StatusCode::OK)
    }).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Runtime error".into()))?
}

#[derive(Serialize, Deserialize)]
pub struct User {
    pub username: String,
    pub is_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let users = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn.prepare("SELECT username, is_admin, allowed_projects FROM users").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map([], |row| {
            Ok(json!({
                "username": row.get::<_, String>(0)?,
                "is_admin": row.get::<_, i32>(1)? == 1,
                "role": if row.get::<_, i32>(1)? == 1 { "admin" } else { "user" },
                "allowed_projects": row.get::<_, Option<String>>(2)?,
            }))
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(u) = row { result.push(u); }
        }
        Ok::<_, StatusCode>(result)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(users))
}

#[derive(Deserialize)]
pub struct UpdateProjectsRequest {
    pub allowed_projects: Option<String>,
}

pub async fn update_user_projects(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(username): Path<String>,
    Json(payload): Json<UpdateProjectsRequest>,
) -> Result<StatusCode, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let allowed_projects = payload.allowed_projects;

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("UPDATE users SET allowed_projects = ?1 WHERE username = ?2", rusqlite::params![allowed_projects, username])
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

pub async fn create_user(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<User>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Forbidden".into()));
    }
    let db = Arc::clone(&state.db_manager);
    let password = payload.password.unwrap_or_else(|| "fortenlog2026".to_string());
    
    if let Err(e) = validate_password_strength(&password) {
        return Err((StatusCode::BAD_REQUEST, e));
    }
    
    let username = payload.username;
    let is_admin = payload.is_admin;
    
    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "DB Error".into()))?;
        // Hash password
        let salt = argon2::password_hash::SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hashing failed".into()))?
            .to_string();
        
        conn.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?1, ?2, ?3)",
            rusqlite::params![username, password_hash, if is_admin { 1 } else { 0 }],
        ).map_err(|_| (StatusCode::CONFLICT, "User already exists".into()))?;

        Ok(StatusCode::CREATED)
    }).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Runtime error".into()))?
}

pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(username): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("DELETE FROM users WHERE username = ?1", [username])
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

#[derive(Deserialize)]
pub struct AdminResetPasswordRequest {
    pub new_password: String,
}

pub async fn admin_reset_password(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(username): Path<String>,
    Json(payload): Json<AdminResetPasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Forbidden".into()));
    }
    if let Err(e) = validate_password_strength(&payload.new_password) {
        return Err((StatusCode::BAD_REQUEST, e));
    }
    
    let db = Arc::clone(&state.db_manager);
    let new_password = payload.new_password;

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "DB Error".into()))?;
        let salt = argon2::password_hash::SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        let new_hash = Argon2::default()
            .hash_password(new_password.as_bytes(), &salt)
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hashing failed".into()))?
            .to_string();

        conn.execute(
            "UPDATE users SET password_hash = ?1, failed_attempts = 0, locked_until = NULL WHERE username = ?2",
            [new_hash, username]
        ).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Update failed".into()))?;

        Ok(StatusCode::OK)
    }).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Runtime error".into()))?
}

#[derive(Deserialize)]
pub struct UpdateRoleRequest {
    pub role: String,
}

pub async fn update_user_role(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(username): Path<String>,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<StatusCode, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let is_admin = if payload.role == "admin" { 1 } else { 0 };

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("UPDATE users SET is_admin = ?1 WHERE username = ?2", rusqlite::params![is_admin, username])
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}

pub async fn get_current_user(
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    Ok(Json(json!({
        "username": claims.sub,
        "is_admin": claims.is_admin,
        "password_change_required": claims.password_change_required,
    })))
}
