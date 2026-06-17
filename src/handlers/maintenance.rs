use std::sync::Arc;
use std::collections::HashMap;
use crate::db::DbManager;
use crate::handlers::ingest::AppState;
use axum::{extract::State, Json};
use serde_json::{json, Value};
use tokio::task;

pub async fn run_compression(
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let db = Arc::clone(&state.db_manager);
    task::spawn_blocking(move || {
        perform_compression(&db);
    }).await.unwrap();
    
    Json(json!({ "status": "ok", "message": "Infrastructure compressed" }))
}

pub fn perform_compression(db: &DbManager) {
    let projects = get_all_projects(db);
    
    // Get compression settings from system DB
    let age_days: i64 = 14 * 30; // Hardcoded retention threshold for resolved/suspended issues (14 months)

    let gdpr_days: i64 = if let Ok(conn) = db.get_system_conn() {
        conn.query_row("SELECT value FROM system_settings WHERE key = 'compression_age_days'", [], |row| {
            let s: String = row.get(0)?;
            Ok(s.parse::<i64>().unwrap_or(30))
        }).unwrap_or(30)
    } else { 30 };

    for pid in projects {
        if let Ok(pool) = db.get_project_pool(&pid) {
            if let Ok(conn) = pool.get() {
                // 1. Storage Optimization: Remove heavy payloads for old PostHog events
                // We keep the `events` row so OS/Browser/Region stats don't break,
                // but we orphan the `payload_hash` so the heavy JSON is deleted below.
                let _ = conn.execute(
                    "UPDATE events 
                     SET payload_hash = NULL 
                     WHERE event_type = 'posthog' 
                     AND timestamp < date('now', '-' || ?1 || ' days')",
                    [gdpr_days]
                );

                // 2. Delete old events (older than age_days) for resolved/suspended issues
                let _ = conn.execute(
                    "DELETE FROM events 
                     WHERE timestamp < date('now', '-' || ?1 || ' days')
                     AND issue_id IN (SELECT id FROM issues WHERE status IN ('resolved', 'suspended'))",
                    [age_days]
                );

                // 3. Hard retention limit for all events (e.g. unhandled ones)
                let max_retention = age_days.max(180);
                let _ = conn.execute(
                    "DELETE FROM events 
                     WHERE timestamp < date('now', '-' || ?1 || ' days')",
                    [max_retention]
                );

                // GDPR IP & HWID Masking: Mask IPs and HWIDs of events older than gdpr_days
                if let Ok(mut stmt) = conn.prepare("SELECT id, ip_address, hwid FROM events WHERE timestamp < date('now', '-' || ?1 || ' days') AND (ip_address IS NOT NULL OR (hwid IS NOT NULL AND hwid != 'REDACTED'))") {
                    let rows = stmt.query_map([gdpr_days], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?))
                    }).ok();
                    if let Some(rows) = rows {
                        for r in rows.flatten() {
                            let masked_ip = r.1.map(|ip| if ip == "REDACTED" { ip } else { crate::middleware::auth::mask_ip(&ip) });
                            let _ = conn.execute("UPDATE events SET ip_address = ?1, hwid = 'REDACTED' WHERE id = ?2", rusqlite::params![masked_ip, r.0]);
                        }
                    }
                }

                // 2. Cleanup orphaned payloads
                let _ = conn.execute(
                    "DELETE FROM payloads WHERE hash NOT IN (SELECT payload_hash FROM events WHERE payload_hash IS NOT NULL)",
                    []
                );

                // 3. Cleanup orphaned stack traces
                let _ = conn.execute(
                    "DELETE FROM stack_traces WHERE hash NOT IN (SELECT stack_hash FROM events)",
                    []
                );

                // 4. Shrink DB
                let _ = conn.execute("VACUUM", []);
            }
        }
    }
}

pub async fn storage_policy_worker(db_manager: Arc<DbManager>) {
    loop {
        // Enforce automated backups check in a blocking task safely to avoid blocking executor
        let db_clone = Arc::clone(&db_manager);
        let _ = task::spawn_blocking(move || {
            if let Err(e) = enforce_automated_backups(&db_clone) {
                eprintln!("[MAINTENANCE ERROR] Auto-backup failed: {}", e);
            }
        }).await;

        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await; // Every hour
        
        // 1. Check total storage
        let (total_used, _, free_space) = match get_storage_metrics(&db_manager).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        let total_capacity = total_used + free_space;
        let usage_percent = (total_used as f64 / total_capacity as f64) * 100.0;

        // 2. Get threshold and auto_purge setting
        let (max_mb, auto_purge) = if let Ok(conn) = db_manager.get_system_conn() {
            let max_mb: i64 = conn.query_row("SELECT value FROM system_settings WHERE key = 'max_storage_mb'", [], |row| {
                let s: String = row.get(0)?;
                Ok(s.parse::<i64>().unwrap_or(0))
            }).unwrap_or(0);
            let auto_purge: bool = conn.query_row("SELECT value FROM system_settings WHERE key = 'auto_purge_enabled'", [], |row| {
                let s: String = row.get(0)?;
                Ok(s == "true")
            }).unwrap_or(true);
            (max_mb, auto_purge)
        } else { (0, true) };

        // 3. Apply policies
        let mut should_purge = false;
        if usage_percent > 90.0 && auto_purge {
            should_purge = true;
        }
        if max_mb > 0 && (total_used / 1024 / 1024) > (max_mb as u64) {
            should_purge = true;
        }

        if should_purge {
            perform_compression(&db_manager);
        }
    }
}

fn enforce_automated_backups(db: &DbManager) -> Result<(), Box<dyn std::error::Error>> {
    let conn = db.get_system_conn()?;

    // Query backup settings
    let auto_backup_enabled: String = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'auto_backup_enabled'",
        [],
        |row| row.get(0)
    ).unwrap_or_else(|_| "false".to_string());

    if auto_backup_enabled != "true" {
        return Ok(());
    }

    let retention_limit: usize = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'backup_retention_limit'",
        [],
        |row| row.get(0)
    ).ok().and_then(|s: String| s.parse().ok()).unwrap_or(2);

    let backup_schedule: String = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'backup_schedule'",
        [],
        |row| row.get(0)
    ).unwrap_or_else(|_| "daily".to_string());

    let last_backup_timestamp_str: Option<String> = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'last_backup_timestamp'",
        [],
        |row| row.get(0)
    ).ok();

    // Check if backup is due
    let now = chrono::Utc::now();
    let is_due = match last_backup_timestamp_str {
        None => true,
        Some(ts_str) => {
            if let Ok(last_backup) = chrono::DateTime::parse_from_rfc3339(&ts_str) {
                let diff = now.signed_duration_since(last_backup.with_timezone(&chrono::Utc));
                match backup_schedule.as_str() {
                    "hourly" => diff.num_hours() >= 1,
                    "twice_daily" => diff.num_hours() >= 12,
                    "three_times_weekly" => diff.num_hours() >= 56,
                    "weekly" => diff.num_days() >= 7,
                    "daily" | _ => diff.num_days() >= 1,
                }
            } else {
                true
            }
        }
    };

    if is_due {
        println!("[MAINTENANCE] Auto-backup is due. Creating snapshots...");
        // 1. Create System Backup
        let system_timestamp = chrono::Utc::now().timestamp();
        let backup_dir = "./data/backups";
        std::fs::create_dir_all(backup_dir)?;
        let system_backup_path = format!("{}/system_{}.db", backup_dir, system_timestamp);

        // Perform SQLite backup for system database safely
        let mut backup_conn = rusqlite::Connection::open(&system_backup_path)?;
        {
            let system_src = db.get_system_conn()?;
            let backup = rusqlite::backup::Backup::new(&system_src, &mut backup_conn)?;
            backup.step(-1)?;
        }

        // 2. Create Project Database Backups for all projects
        if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
            let projects: Vec<String> = stmt.query_map([], |row| row.get(0))?.filter_map(|r| r.ok()).collect();
            for pid in projects {
                if let Ok(pool) = db.get_project_pool(&pid) {
                    if let Ok(proj_conn) = pool.get() {
                        let proj_backup_path = format!("{}/{}_{}.db", backup_dir, pid, system_timestamp);
                        if let Ok(mut dest_conn) = rusqlite::Connection::open(&proj_backup_path) {
                            if let Ok(backup) = rusqlite::backup::Backup::new(&proj_conn, &mut dest_conn) {
                                let _ = backup.step(-1);
                            }
                        }
                    }
                }
            }
        }

        // 3. Update last backup timestamp
        let now_rfc = now.to_rfc3339();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('last_backup_timestamp', ?1)",
            [now_rfc]
        );

        // 4. Prune excess old backups to enforce backup_retention_limit
        let mut target_backups: HashMap<String, Vec<(String, u64)>> = HashMap::new();

        if let Ok(entries) = std::fs::read_dir(backup_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        let path = entry.path();
                        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                            if filename.ends_with(".db") {
                                let name_without_ext = filename.replace(".db", "");
                                let parts: Vec<&str> = name_without_ext.split('_').collect();
                                if parts.len() >= 2 {
                                    let target_id = parts[0..parts.len()-1].join("_");
                                    if let Some(timestamp_str) = parts.last() {
                                        if let Ok(ts) = timestamp_str.parse::<u64>() {
                                            target_backups.entry(target_id).or_insert_with(Vec::new).push((filename.to_string(), ts));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Prune older files for each target
        for (target, mut files) in target_backups {
            files.sort_by_key(|f| f.1);
            if files.len() > retention_limit {
                let to_prune_count = files.len() - retention_limit;
                for i in 0..to_prune_count {
                    let file_to_delete = format!("{}/{}", backup_dir, files[i].0);
                    println!("[MAINTENANCE] Pruning old backup snapshot for {}: {}", target, file_to_delete);
                    let _ = std::fs::remove_file(file_to_delete);
                }
            }
        }
    }

    Ok(())
}

async fn get_storage_metrics(db: &DbManager) -> anyhow::Result<(u64, Vec<Value>, u64)> {
    let system_pool = db.system_pool.clone();
    let project_pools = db.project_pools.clone();
    let base_path = db.base_path.clone();
    
    task::spawn_blocking(move || {
        let mut total_size = 0;
        let mut project_stats = Vec::new();

        // 1. System DB size
        if let Ok(meta) = std::fs::metadata(base_path.join("system.db")) {
            total_size += meta.len();
        }

        // Get registered projects
        let registered_projects: std::collections::HashMap<String, String> = if let Ok(conn) = system_pool.get() {
            if let Ok(mut stmt) = conn.prepare("SELECT id, name FROM projects") {
                stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
            } else { std::collections::HashMap::new() }
        } else { std::collections::HashMap::new() };

        // 2. Project DBs sizes
        if let Ok(entries) = std::fs::read_dir(base_path.join("projects")) {
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
                        if let Some(pool) = project_pools.get(&id) {
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
        let canonical_path = std::fs::canonicalize(&base_path).unwrap_or_else(|_| base_path.clone());
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

        Ok((total_size, project_stats, free_space))
    }).await?
}

fn get_all_projects(db: &DbManager) -> Vec<String> {
    if let Ok(conn) = db.get_system_conn() {
        if let Ok(mut stmt) = conn.prepare("SELECT id FROM projects") {
            return stmt.query_map([], |row| row.get(0)).ok().map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default();
        }
    }
    vec![]
}
