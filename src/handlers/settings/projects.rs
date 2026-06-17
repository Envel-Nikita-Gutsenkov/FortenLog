use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

pub async fn list_projects(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Vec<Value>>, StatusCode> {
    let db = Arc::clone(&state.db_manager);
    let is_admin = claims.is_admin;
    let username = claims.sub.clone();
    let projects = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        // Fetch allowed projects for non-admin
        let allowed_projects: Option<String> = if !is_admin {
            conn.query_row(
                "SELECT allowed_projects FROM users WHERE username = ?1",
                [&username],
                |row| row.get(0)
            ).unwrap_or(None)
        } else {
            None
        };

        let mut stmt = conn.prepare("SELECT id, name, api_key, created_at, retention_days, cache_size_mb, github_repo FROM projects").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map([], |row| {
            let raw_key = row.get::<_, String>(2)?;
            let key = raw_key;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "api_key": key,
                "created_at": row.get::<_, String>(3)?,
                "retention_days": row.get::<_, i64>(4).unwrap_or(14),
                "cache_size_mb": row.get::<_, i64>(5).unwrap_or(256),
                "github_repo": row.get::<_, Option<String>>(6)?,
            }))
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let mut result = Vec::new();
        for row in rows {
            if let Ok(p) = row {
                if !is_admin {
                    if let Some(ref allowed) = allowed_projects {
                        let list: Vec<&str> = allowed.split(',').map(|s| s.trim()).collect();
                        if list.contains(&p["id"].as_str().unwrap_or("")) {
                            result.push(p);
                        }
                    }
                } else {
                    result.push(p);
                }
            }
        }
        Ok::<_, StatusCode>(result)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(projects))
}

fn slugify(s: &str) -> String {
    let mut slug = s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        slug = "project".to_string();
    }
    slug
}

pub async fn create_project(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<Value>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("New Project").to_string();
    
    // Check if the user explicitly provided an ID, or if it was left blank/null
    let provided_id = payload.get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let retention_days = payload.get("retention_days").and_then(|v| v.as_i64()).unwrap_or(14);
    let cache_size_mb = payload.get("cache_size_mb").and_then(|v| v.as_i64()).unwrap_or(256);
    let github_repo = payload.get("github_repo")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let state_clone = state.clone();
    let name_clone = name.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        let target_id = match provided_id {
            Some(explicit_id) => {
                // The user explicitly entered an ID. Check if it already exists to return CONFLICT.
                let exists: bool = conn.query_row(
                    "SELECT 1 FROM projects WHERE id = ?1",
                    [&explicit_id],
                    |_| Ok(true)
                ).unwrap_or(false);
                
                if exists {
                    return Err(StatusCode::CONFLICT);
                }
                explicit_id
            }
            None => {
                // ID was not provided or empty. Auto-generate a unique slug.
                let base_slug = slugify(&name_clone);
                let mut final_slug = base_slug.clone();
                let mut attempts = 0;
                
                while attempts < 10 {
                    let exists: bool = conn.query_row(
                        "SELECT 1 FROM projects WHERE id = ?1",
                        [&final_slug],
                        |_| Ok(true)
                    ).unwrap_or(false);
                    
                    if !exists {
                        break;
                    }
                    
                    // Slug exists. Append a random 4-char suffix to guarantee uniqueness.
                    use rand::{distributions::Alphanumeric, Rng};
                    let suffix: String = rand::thread_rng()
                        .sample_iter(&Alphanumeric)
                        .take(4)
                        .map(char::from)
                        .collect::<String>()
                        .to_lowercase();
                    final_slug = format!("{}-{}", base_slug, suffix);
                    attempts += 1;
                }
                final_slug
            }
        };

        let api_key = format!("fl_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));

        // Insert project into system DB
        let affected = conn.execute(
            "INSERT INTO projects (id, name, api_key, retention_days, cache_size_mb, github_repo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![&target_id, &name_clone, &api_key, retention_days, cache_size_mb, github_repo],
        ).map_err(|e| {
            eprintln!("[ERROR] Failed to insert project into system DB: {:?}", e);
            state_clone.db_manager.log_internal_error("create_project", &format!("Failed to insert project: {}", e), Some(&target_id));
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        if affected == 0 {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }

        // Pre-warm the project database pool
        state_clone.db_manager.get_project_pool(&target_id).map_err(|e| {
            eprintln!("[ERROR] Failed to pre-warm project pool: {:?}", e);
            state_clone.db_manager.log_internal_error("create_project", &format!("Failed to warm pool: {}", e), Some(&target_id));
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        Ok::<_, StatusCode>((target_id, name_clone))
    }).await;

    match result {
        Ok(Ok((final_id, final_name))) => {
            crate::handlers::settings_audit::log_audit(
                state.db_manager.clone(),
                "admin",
                "CREATE_PROJECT",
                &format!("ID: {}, Name: {}", final_id, final_name)
            ).await;
            StatusCode::OK
        }
        Ok(Err(status)) => status,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn update_project(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<Value>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let state_clone = state.clone();
    let id_clone = id.clone();
    let payload_clone = payload.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if let Some(n) = payload_clone.get("name").and_then(|v| v.as_str()) {
            let _ = conn.execute("UPDATE projects SET name = ?1 WHERE id = ?2", [n, &id_clone]);
        }
        if let Some(ret) = payload_clone.get("retention_days").and_then(|v| v.as_i64()) {
            let _ = conn.execute("UPDATE projects SET retention_days = ?1 WHERE id = ?2",
                rusqlite::params![ret, &id_clone]);
        }
        if let Some(cache_mb) = payload_clone.get("cache_size_mb").and_then(|v| v.as_u64()) {
            let _ = conn.execute("UPDATE projects SET cache_size_mb = ?1 WHERE id = ?2",
                rusqlite::params![cache_mb as i64, &id_clone]);
            // Apply immediately — resize the live in-memory cache without restart
            state_clone.db_manager.resize_project_cache(&id_clone, cache_mb);
        }
        if let Some(repo) = payload_clone.get("github_repo") {
            let repo_val = repo.as_str().map(|s| s.trim()).filter(|s| !s.is_empty());
            let _ = conn.execute("UPDATE projects SET github_repo = ?1 WHERE id = ?2",
                rusqlite::params![repo_val, &id_clone]);
        }
        Ok::<_, StatusCode>(StatusCode::OK)
    }).await;

    result.unwrap_or(Ok(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn delete_project(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let state_clone = state.clone();
    let id_clone = id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = state_clone.db_manager.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let _ = conn.execute("DELETE FROM projects WHERE id = ?1", [&id_clone]);
        state_clone.db_manager.remove_project_resources(&id_clone);
        Ok::<_, StatusCode>(StatusCode::OK)
    }).await;

    if let Ok(Ok(code)) = result {
        crate::handlers::settings_audit::log_audit(state.db_manager.clone(), "admin", "DELETE_PROJECT", &format!("ID: {}", id)).await;
        code
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}
