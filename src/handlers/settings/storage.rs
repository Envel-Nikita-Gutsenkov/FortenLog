use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

pub async fn get_storage_stats(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        let mut total_size = 0;
        let mut project_stats = Vec::new();

        // 1. System DB size
        if let Ok(meta) = std::fs::metadata("./data/system.db") {
            total_size += meta.len();
        }

        // Get registered projects
        let registered_projects: std::collections::HashMap<String, String> = if let Ok(conn) = db.get_system_conn() {
            if let Ok(mut stmt) = conn.prepare("SELECT id, name FROM projects") {
                stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
            } else { std::collections::HashMap::new() }
        } else { std::collections::HashMap::new() };

        // 2. Project DBs sizes
        if let Ok(entries) = std::fs::read_dir("./data/projects") {
            for entry in entries.filter_map(|e| e.ok()) {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() && entry.path().extension().and_then(|s| s.to_str()) == Some("db") {
                        let id = entry.file_name().into_string().unwrap_or_default().replace(".db", "");
                        if !registered_projects.contains_key(&id) {
                            continue;
                        }

                        let size = meta.len();
                        total_size += size;
                        
                        let name = registered_projects.get(&id).cloned().unwrap_or_else(|| id.clone());
                        let mut event_count = 0;
                        if let Ok(pool) = db.get_project_pool(&id) {
                            if let Ok(conn) = pool.get() {
                                event_count = conn.query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0)).unwrap_or(0);
                            }
                        }

                        project_stats.push(json!({
                            "id": id,
                            "name": name,
                            "size_bytes": size,
                            "event_count": event_count
                        }));
                    }
                }
            }
        }

        // 3. System free space
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        let canonical_path = std::fs::canonicalize("./data").unwrap_or_else(|_| std::path::PathBuf::from("./data"));
        let free_space = disks.iter()
            .filter(|d| canonical_path.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| d.available_space())
            .or_else(|| {
                disks.iter()
                    .find(|d| d.mount_point() == std::path::Path::new("/"))
                    .map(|d| d.available_space())
            })
            .unwrap_or(100 * 1024 * 1024 * 1024);

        (total_size, project_stats, free_space)
    }).await.unwrap_or((0, Vec::new(), 100 * 1024 * 1024 * 1024));

    Ok(Json(json!({
        "total_size_bytes": result.0,
        "projects": result.1,
        "free_space_bytes": result.2,
        "last_vacuum": chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
    })))
}

pub async fn create_backup(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_project_pool(&id).map_err(|_| StatusCode::NOT_FOUND)?.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let backup_path = format!("./data/backups/{}_{}.db", id, chrono::Utc::now().timestamp());
        std::fs::create_dir_all("./data/backups").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("VACUUM INTO ?1", [backup_path]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await;
    
    result.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn create_system_backup(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let backup_path = format!("./data/backups/system_{}.db", chrono::Utc::now().timestamp());
        std::fs::create_dir_all("./data/backups").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("VACUUM INTO ?1", [backup_path]).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await;
    
    result.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn vacuum_project(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.get_project_pool(&id).map_err(|_| StatusCode::NOT_FOUND)?.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.execute("VACUUM", []).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(StatusCode::OK)
    }).await;
    
    result.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn vacuum_all_databases(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        // 1. Vacuum system DB
        if let Ok(conn) = db.get_system_conn() {
            let _ = conn.execute("VACUUM", []);
        }
        
        // 2. Vacuum project DBs
        let projects = if let Ok(conn) = db.get_system_conn() {
            if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
                stmt.query_map([], |row| row.get::<_, String>(0)).unwrap().filter_map(|r| r.ok()).collect::<Vec<_>>()
            } else { vec![] }
        } else { vec![] };

        for pid in projects {
            if let Ok(pool) = db.get_project_pool(&pid) {
                if let Ok(conn) = pool.get() {
                    let _ = conn.execute("VACUUM", []);
                }
            }
        }
        Ok::<_, StatusCode>(StatusCode::OK)
    }).await;

    if let Ok(Ok(code)) = result {
        crate::handlers::settings_audit::log_audit(state.db_manager.clone(), "admin", "SYSTEM_VACUUM", "Optimized system and all project databases").await;
        code
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub async fn list_system_backups(
    State(_state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let result = tokio::task::spawn_blocking(move || {
        let mut list = Vec::new();
        let backups_dir = "./data/backups";
        let _ = std::fs::create_dir_all(backups_dir);

        if let Ok(entries) = std::fs::read_dir(backups_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        let filename = entry.file_name().into_string().unwrap_or_default();
                        if filename.ends_with(".db") {
                            let size_bytes = meta.len();
                            
                            let (backup_type, id_part, timestamp_part) = if filename.starts_with("system_") {
                                let ts_str = filename.replace("system_", "").replace(".db", "");
                                ("system".to_string(), "system".to_string(), ts_str)
                            } else {
                                let name_without_ext = filename.replace(".db", "");
                                let parts: Vec<&str> = name_without_ext.split('_').collect();
                                if parts.len() >= 2 {
                                    let id = parts[0..parts.len()-1].join("_");
                                    let ts = parts[parts.len()-1].to_string();
                                    ("project".to_string(), id, ts)
                                } else {
                                    ("unknown".to_string(), filename.clone(), "0".to_string())
                                }
                            };
                            
                            let timestamp = timestamp_part.parse::<i64>().unwrap_or(0);
                            let created_at = if timestamp > 0 {
                                if let Some(dt) = chrono::DateTime::from_timestamp(timestamp, 0) {
                                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                                } else {
                                    "Unknown".to_string()
                                }
                            } else {
                                "Unknown".to_string()
                            };

                            list.push(json!({
                                "filename": filename,
                                "size_bytes": size_bytes,
                                "created_at": created_at,
                                "type": backup_type,
                                "id": id_part
                            }));
                        }
                    }
                }
            }
        }
        list.sort_by(|a, b| {
            let a_filename = a["filename"].as_str().unwrap_or("");
            let b_filename = b["filename"].as_str().unwrap_or("");
            b_filename.cmp(a_filename)
        });
        list
    }).await.unwrap_or(Vec::new());

    Ok(Json(json!(result)))
}

pub async fn delete_system_backup(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    if filename.contains('/') || filename.contains('\\') || !filename.ends_with(".db") {
        return StatusCode::BAD_REQUEST;
    }
    let path = format!("./data/backups/{}", filename);
    let result = std::fs::remove_file(&path);
    if result.is_ok() {
        let action_details = format!("Deleted backup snapshot: {}", filename);
        let db_manager_clone = Arc::clone(&state.db_manager);
        tokio::spawn(async move {
            crate::handlers::settings_audit::log_audit(db_manager_clone, "admin", "DELETE_BACKUP", &action_details).await;
        });
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn restore_system_backup(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    if filename.contains('/') || filename.contains('\\') || !filename.ends_with(".db") {
        return StatusCode::BAD_REQUEST;
    }
    
    let db = Arc::clone(&state.db_manager);
    let filename_for_task = filename.clone();
    let result = tokio::task::spawn_blocking(move || {
        let backup_path = format!("./data/backups/{}", filename_for_task);
        if !std::path::Path::new(&backup_path).exists() {
            return Err(StatusCode::NOT_FOUND);
        }

        if filename_for_task.starts_with("system_") {
            let src = rusqlite::Connection::open(&backup_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let mut dest = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            
            let backup = rusqlite::backup::Backup::new(&src, &mut dest)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            
            backup.step(-1).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::OK)
        } else {
            let name_without_ext = filename_for_task.replace(".db", "");
            let parts: Vec<&str> = name_without_ext.split('_').collect();
            if parts.len() < 2 {
                return Err(StatusCode::BAD_REQUEST);
            }
            let project_id = parts[0..parts.len()-1].join("_");

            db.remove_project_resources(&project_id);

            let project_db_path = format!("./data/projects/{}.db", project_id);
            if std::fs::copy(&backup_path, &project_db_path).is_ok() {
                Ok(StatusCode::OK)
            } else {
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    }).await;

    if let Ok(Ok(code)) = result {
        let action_details = format!("Restored backup snapshot: {}", filename);
        let db_manager_clone = Arc::clone(&state.db_manager);
        tokio::spawn(async move {
            crate::handlers::settings_audit::log_audit(db_manager_clone, "admin", "RESTORE_BACKUP", &action_details).await;
        });
        code
    } else {
        result.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_err()
    }
}
