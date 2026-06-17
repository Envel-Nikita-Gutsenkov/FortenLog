use axum::{extract::{State, Path as AxumPath}, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use tokio::task;
use argon2::PasswordVerifier;

#[derive(Deserialize)]
pub struct UpdateIssueRequest {
    pub status: Option<String>,
    pub is_suppressed: Option<bool>,
    pub resolved_in_version: Option<String>,
}

pub async fn update_issue(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, id)): AxumPath<(String, String)>,
    Json(payload): Json<UpdateIssueRequest>,
) -> Result<Json<Value>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let affected = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            let mut query = "UPDATE issues SET id=id".to_string();
            let mut params: Vec<rusqlite::types::Value> = Vec::new();

            if let Some(status) = &payload.status {
                query.push_str(", status = ?");
                params.push(status.clone().into());
            }
            if let Some(suppressed) = payload.is_suppressed {
                query.push_str(", is_suppressed = ?");
                params.push((if suppressed { 1 } else { 0 }).into());
            }
            if let Some(version) = &payload.resolved_in_version {
                query.push_str(", resolved_in_version = ?");
                params.push(version.clone().into());
            }
            query.push_str(" WHERE id = ?");
            params.push(id.clone().into());

            if conn.execute(&query, rusqlite::params_from_iter(params)).unwrap_or(0) > 0 {
                return true;
            }
        }
        false
    }).await.unwrap_or(false);

    if affected {
        state.db_manager.invalidate_dashboard_cache(&project_id).await;
        Ok(Json(json!({ "status": "ok" })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn delete_issue(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, id)): AxumPath<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        tracing::warn!("[AUTH_VIOLATION] Non-admin user '{}' tried to delete telemetry issue '{}'", claims.sub, id);
        return Err(StatusCode::FORBIDDEN);
    }

    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let affected = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            let _ = conn.execute("DELETE FROM events WHERE issue_id = ?1", rusqlite::params![id.as_str()]);
            if conn.execute("DELETE FROM issues WHERE id = ?1", rusqlite::params![id.as_str()]).unwrap_or(0) > 0 {
                return true;
            }
        }
        false
    }).await.unwrap_or(false);

    if affected {
        state.db_manager.invalidate_dashboard_cache(&project_id).await;
        Ok(Json(json!({ "status": "ok" })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub async fn resolve_issue(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    AxumPath((project_id, id)): AxumPath<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let affected = task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            if conn.execute("UPDATE issues SET status = 'resolved' WHERE id = ?1", rusqlite::params![id.as_str()]).unwrap_or(0) > 0 {
                return true;
            }
        }
        false
    }).await.unwrap_or(false);

    if affected {
        state.db_manager.invalidate_dashboard_cache(&project_id).await;
        Ok(Json(json!({ "status": "ok" })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Deserialize)]
pub struct ClearDataRequest {
    pub password: String,
}

pub async fn clear_project_data(
    State(state): State<Arc<AppState>>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    AxumPath(id): AxumPath<String>,
    Json(payload): Json<ClearDataRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Admin role required".into()));
    }
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let password = payload.password;
    let pid = id.clone();

    let res = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "DB Error".into()))?;
        let hash: String = conn.query_row("SELECT password_hash FROM users WHERE username = ?1", [&username], |row| row.get(0))
            .map_err(|_| (StatusCode::UNAUTHORIZED, "User not found".into()))?;
        
        let parsed_hash = argon2::PasswordHash::new(&hash).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Hash error".into()))?;
        if argon2::Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_err() {
            return Err((StatusCode::UNAUTHORIZED, "Invalid administrative password".into()));
        }

        let pool = db.get_project_pool(&pid).map_err(|_| (StatusCode::NOT_FOUND, "Project not found".into()))?;
        let mut p_conn = pool.get().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Pool error".into()))?;
        let tx = p_conn.transaction().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "TX error".into()))?;
        tx.execute("DELETE FROM events", []).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Purge failed".into()))?;
        tx.execute("DELETE FROM issues", []).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Purge failed".into()))?;
        tx.commit().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Commit failed".into()))?;
        
        Ok(StatusCode::OK)
    }).await.map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Runtime error".into()))?;

    match res {
        Ok(code) => {
            state.db_manager.invalidate_dashboard_cache(&id).await;
            Ok(code)
        },
        Err(e) => Err(e)
    }
}

pub fn get_all_project_ids(db: &crate::db::DbManager) -> Vec<String> {
    if let Ok(conn) = db.get_system_conn() {
        if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
            return stmt.query_map([], |row| row.get(0)).ok().map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default();
        }
    }
    vec![]
}
