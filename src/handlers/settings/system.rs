use axum::{extract::State, Json, http::StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

pub async fn get_system_settings(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        let mut settings = json!({
            "auto_vacuum": "true",
            "pii_anonymization": "true",
            "retention_days": "14"
        });

        let commit_hash = std::process::Command::new("git")
            .args(["rev-parse", "--short", "HEAD"])
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "81532e1d".to_string());

        let commit_date = std::process::Command::new("git")
            .args(["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M:%S"])
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "2026-05-18 13:44:15".to_string());

        settings["_software_version"] = json!(env!("CARGO_PKG_VERSION"));
        settings["_build_commit"] = json!(commit_hash);
        settings["_build_date"] = json!(commit_date);
        if let Ok(conn) = db.get_system_conn() {
            if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM system_settings") {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for row in rows.filter_map(|r| r.ok()) {
                        settings[row.0] = json!(row.1);
                    }
                }
            }
        }
        settings
    }).await.unwrap_or_else(|_| json!({}));
    
    Ok(Json(result))
}

pub async fn update_system_settings(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(payload): Json<Value>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db.get_system_conn() {
            if let Some(obj) = payload.as_object() {
                for (k, v) in obj {
                    let val_str = match v {
                        Value::String(s) => s.clone(),
                        Value::Bool(b) => b.to_string(),
                        _ => v.to_string(),
                    };
                    let _ = conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?1, ?2)", [k, &val_str]);
                }
                return Ok(StatusCode::OK);
            }
        }
        Err(StatusCode::INTERNAL_SERVER_ERROR)
    }).await;

    result.unwrap_or(Err(StatusCode::INTERNAL_SERVER_ERROR)).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn get_system_performance(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<Value>, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    use std::sync::atomic::Ordering;
    use sysinfo::System;

    let metrics = &state.metrics;

    // 1. Gather System Metrics (using 100ms sample window for perfect CPU calculation)
    let (total_mem, used_mem, process_cpu, process_mem, system_cpu) = tokio::task::spawn_blocking(move || {
        let mut sys = System::new_all();
        sys.refresh_all();
        std::thread::sleep(std::time::Duration::from_millis(100));
        sys.refresh_cpu();
        sys.refresh_processes();

        let total_mem = sys.total_memory();
        let used_mem = sys.used_memory();

        let mut proc_cpu = 0.0;
        let mut proc_mem = 0;
        if let Some(pid) = sysinfo::get_current_pid().ok() {
            if let Some(proc) = sys.process(pid) {
                proc_cpu = proc.cpu_usage();
                proc_mem = proc.memory();
            }
        }

        let sys_cpu = if !sys.cpus().is_empty() {
            sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
        } else {
            0.0
        };

        (total_mem, used_mem, proc_cpu, proc_mem, sys_cpu)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 2. Query latest internal errors
    let db = Arc::clone(&state.db_manager);
    let errors = tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut stmt = conn.prepare("SELECT id, timestamp, component, error_message, context FROM internal_errors ORDER BY id DESC LIMIT 50")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rows = stmt.query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "timestamp": row.get::<_, String>(1)?,
                "component": row.get::<_, String>(2)?,
                "error_message": row.get::<_, String>(3)?,
                "context": row.get::<_, String>(4)?,
            }))
        }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut list = Vec::new();
        for row in rows {
            if let Ok(r) = row { list.push(r); }
        }
        Ok::<_, StatusCode>(list)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    // 3. Query project performance.
    let db_for_perf = Arc::clone(&state.db_manager);

    let pool_stats = tokio::task::spawn_blocking(move || {
        let mut limits = std::collections::HashMap::new();
        if let Ok(sys_conn) = db_for_perf.get_system_conn() {
            if let Ok(mut stmt) = sys_conn.prepare("SELECT id, cache_size_mb FROM projects") {
                if let Ok(rows) = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))) {
                    for row in rows.filter_map(|r| r.ok()) {
                        limits.insert(row.0, row.1);
                    }
                }
            }
        }

        let mut entries = Vec::new();
        for item in db_for_perf.project_pools.iter() {
            let pid = item.key().clone();
            let s = item.value().state();
            let limit_mb = limits.get(&pid).copied().unwrap_or(256);
            entries.push((pid, s.connections, s.idle_connections, limit_mb));
        }
        entries
    }).await.unwrap_or_default();

    let mut project_perf = Vec::with_capacity(pool_stats.len());
    for (pid, connections, idle_connections, limit_mb) in pool_stats {
        let cache_bytes = if let Some(cache) = state.db_manager.project_caches.get(&pid) {
            cache.run_pending_tasks().await;
            cache.weighted_size()
        } else {
            0
        };
        project_perf.push(json!({
            "project_id": pid,
            "connections": connections,
            "idle_connections": idle_connections,
            "cache_used_bytes": cache_bytes,
            "cache_limit_mb": limit_mb
        }));
    }

    Ok(Json(json!({
        "metrics": {
            "total_received": metrics.total_received.load(Ordering::Relaxed),
            "total_processed": metrics.total_processed.load(Ordering::Relaxed),
            "total_dropped": metrics.total_dropped.load(Ordering::Relaxed),
            "total_rate_limited": metrics.total_rate_limited.load(Ordering::Relaxed),
            "last_latency_micros": metrics.last_latency_micros.load(Ordering::Relaxed),
            "db_flushes_success": metrics.db_flushes_success.load(Ordering::Relaxed),
            "db_flushes_failed": metrics.db_flushes_failed.load(Ordering::Relaxed),
            "ingest_channel_remaining": state.ingest_tx.capacity(),
            "session_channel_remaining": state.session_tx.capacity(),
            "system_total_mem_bytes": total_mem,
            "system_used_mem_bytes": used_mem,
            "process_cpu_percent": process_cpu,
            "process_mem_bytes": process_mem,
            "system_cpu_percent": system_cpu,
        },
        "errors": errors,
        "projects_performance": project_perf,
    })))
}

pub async fn clear_internal_errors(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> StatusCode {
    if !claims.is_admin {
        return StatusCode::FORBIDDEN;
    }
    let db = Arc::clone(&state.db_manager);
    let result = tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db.get_system_conn() {
            let _ = conn.execute("DELETE FROM internal_errors", []);
            Ok(StatusCode::OK)
        } else {
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }).await;

    if let Ok(Ok(code)) = result {
        code
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}
