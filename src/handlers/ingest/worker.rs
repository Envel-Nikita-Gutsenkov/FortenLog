use tokio::sync::mpsc;
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use crate::models::TelemetryEvent;
use crate::db::DbManager;
use crate::handlers::ingest::calculate_hash;
use crate::handlers::ingest::IngestionPerformanceMetrics;

pub async fn ingestion_worker(
    mut rx: mpsc::Receiver<TelemetryEvent>,
    db_manager: Arc<DbManager>,
    batch_size: usize,
    batch_interval_secs: u64,
    issue_rpm_cache: moka::future::Cache<String, u32>,
    metrics: Arc<IngestionPerformanceMetrics>,
) {
    let batch_size = batch_size.max(500);
    let mut batch: Vec<TelemetryEvent> = Vec::with_capacity(batch_size);
    let mut last_flush = std::time::Instant::now();
    
    // User spam deduplication cache (1 hour TTL)
    let user_spam_cache: moka::sync::Cache<String, ()> = moka::sync::Cache::builder()
        .time_to_live(std::time::Duration::from_secs(3600))
        .max_capacity(100_000)
        .build();

    loop {
        let timeout = tokio::time::Duration::from_millis(200);
        match tokio::time::timeout(timeout, rx.recv()).await {
            Ok(Some(event)) => {
                batch.push(event);
                while batch.len() < batch_size {
                    match rx.try_recv() {
                        Ok(ev) => batch.push(ev),
                        Err(_) => break,
                    }
                }
            }
            Ok(None) => break,
            Err(_) => {}
        }

        let should_flush = batch.len() >= batch_size
            || (!batch.is_empty() && last_flush.elapsed().as_secs() >= batch_interval_secs);

        if should_flush {
            flush_batch(&mut batch, &db_manager, &issue_rpm_cache, &user_spam_cache, &metrics).await;
            last_flush = std::time::Instant::now();
        }
    }
    if !batch.is_empty() {
        flush_batch(&mut batch, &db_manager, &issue_rpm_cache, &user_spam_cache, &metrics).await;
    }
}

pub async fn session_worker(
    mut rx: mpsc::Receiver<crate::models::SessionEvent>,
    db_manager: Arc<DbManager>,
) {
    let mut batch = Vec::with_capacity(100);
    let mut last_flush = std::time::Instant::now();

    loop {
        match tokio::time::timeout(tokio::time::Duration::from_millis(500), rx.recv()).await {
            Ok(Some(session)) => {
                batch.push(session);
                if batch.len() >= 100 {
                    flush_sessions(&mut batch, &db_manager).await;
                    last_flush = std::time::Instant::now();
                }
            }
            Ok(None) => break,
            Err(_) => {
                if !batch.is_empty() && last_flush.elapsed().as_secs() >= 5 {
                    flush_sessions(&mut batch, &db_manager).await;
                    last_flush = std::time::Instant::now();
                }
            }
        }
    }
}

async fn flush_sessions(batch: &mut Vec<crate::models::SessionEvent>, db_manager: &Arc<DbManager>) {
    let mut project_sessions = HashMap::new();
    for session in batch.drain(..) {
        project_sessions.entry(session.project_id.clone()).or_insert_with(Vec::new).push(session);
    }

    for (project_id, sessions) in project_sessions {
        if let Ok(pool) = db_manager.get_project_pool(&project_id) {
            if let Ok(conn) = pool.get() {
                let stmt = conn.prepare_cached(
                    "INSERT INTO sessions (id, hwid, release_version, environment, timestamp, is_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
                ).ok();
                if let Some(mut s) = stmt {
                    for sess in sessions {
                        let _ = s.execute(rusqlite::params![
                            sess.id.to_string(), sess.hwid, sess.release_version, sess.environment, sess.timestamp.to_rfc3339(), sess.is_error as i32
                        ]);
                    }
                }
            }
        }
        db_manager.invalidate_dashboard_cache(&project_id).await;
    }
}

async fn flush_batch(
    batch: &mut Vec<TelemetryEvent>,
    db_manager: &Arc<DbManager>,
    issue_rpm_cache: &moka::future::Cache<String, u32>,
    user_spam_cache: &moka::sync::Cache<String, ()>,
    metrics: &Arc<IngestionPerformanceMetrics>,
) {
    if batch.is_empty() { return; }

    let mut project_events = HashMap::new();
    for event in batch.drain(..) {
        project_events.entry(event.project_id.clone()).or_insert_with(Vec::new).push(event);
    }

    for (project_id, events) in project_events {
        let mut event_rpms = HashMap::new();
        for event in &events {
            let rpm = issue_rpm_cache.get(&event.fingerprint).await.unwrap_or(0) + 1;
            issue_rpm_cache.insert(event.fingerprint.clone(), rpm).await;
            event_rpms.insert(event.id.clone(), rpm);
        }

        let pool = match db_manager.get_project_pool(&project_id) {
            Ok(p) => p,
            Err(e) => {
                let err_msg = format!("Failed to get project pool for project '{}': {:?}", project_id, e);
                eprintln!("[DB WORKER ERROR] {}", err_msg);
                db_manager.log_internal_error("ingest_worker", &err_msg, None);
                metrics.db_flushes_failed.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };

        if let Ok(mut conn) = pool.get() {
            if let Ok(tx) = conn.transaction() {
                let mut success = true;

                for event in &events {
                    if event.event_type == "posthog" {
                        // --- Analytics Rollups (Aggregation) ---
                        let mut properties_hash = event.payload_hash.clone();
                        let mut properties_json_str = String::new();
                        let date_bucket = event.timestamp.format("%Y-%m-%d").to_string();
                        let event_name = event.title.as_deref().unwrap_or("unknown");
                        
                        if let Ok(decompressed) = zstd::stream::decode_all(event.payload.as_slice()) {
                            if let Ok(mut val) = serde_json::from_slice::<serde_json::Value>(&decompressed) {
                                crate::handlers::ingest::utils::strip_volatile_analytics_fields(&mut val);
                                let stripped_json = serde_json::to_string(&val).unwrap_or_default();
                                properties_hash = crate::handlers::ingest::calculate_hash(stripped_json.as_bytes());
                                properties_json_str = stripped_json;
                            }
                        }
                        
                        if let Err(e) = tx.execute(
                            "INSERT INTO analytics_rollups (id, event_name, properties_hash, count, properties_json, date_bucket)
                             VALUES (?1, ?2, ?3, 1, ?4, ?5)
                             ON CONFLICT(event_name, properties_hash, date_bucket) DO UPDATE SET
                                 count = count + 1",
                            rusqlite::params![
                                uuid::Uuid::new_v4().to_string(),
                                event_name,
                                properties_hash,
                                properties_json_str,
                                date_bucket
                            ]
                        ) {
                            let err_msg = format!("Failed to insert analytics rollup: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                        }
                        // --- End Analytics Rollups ---

                        let original_size = event.payload.len();
                        if let Err(e) = tx.execute(
                            "INSERT OR IGNORE INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![
                                event.payload_hash,
                                event.payload,
                                original_size as i64,
                                original_size as i64
                            ]
                        ) {
                            let err_msg = format!("Failed to insert payload: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.payload_hash));
                            success = false;
                        }

                        if let Err(e) = tx.execute(
                            "INSERT INTO events (id, issue_id, timestamp, event_type, hwid, ip_address, os, browser, region, release_version, environment, stack_hash, payload_hash, title)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                            rusqlite::params![
                                event.id.to_string(),
                                Option::<String>::None,
                                event.timestamp.to_rfc3339(),
                                event.event_type,
                                event.hwid,
                                event.ip_address,
                                event.os,
                                event.browser,
                                event.region,
                                event.release_version,
                                event.environment,
                                Option::<String>::None,
                                event.payload_hash,
                                event.title,
                            ],
                        ) {
                            let err_msg = format!("Failed to insert event details: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.id.to_string()));
                            success = false;
                        }
                    } else {
                        // --- Issue Spam Deduplication ---
                        let hwid = event.hwid.as_deref().unwrap_or("anon");
                        let spam_key = format!("{}-{}", event.fingerprint, hwid);
                        if user_spam_cache.contains_key(&spam_key) {
                            // User is spamming the exact same error, just increment count
                            if let Err(e) = tx.execute(
                                "UPDATE issues SET count = count + 1, last_seen = ?2 WHERE id = ?1",
                                rusqlite::params![event.fingerprint, event.timestamp.to_rfc3339()]
                            ) {
                                let err_msg = format!("Failed to update spam deduplicated issue: {:?}", e);
                                eprintln!("[DB WORKER ERROR] {}", err_msg);
                                db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.fingerprint));
                            }
                            continue;
                        }
                        user_spam_cache.insert(spam_key, ());
                        // --- End Issue Spam Deduplication ---
                        // Check if issue is suppressed
                        let is_suppressed: bool = tx.query_row(
                            "SELECT is_suppressed FROM issues WHERE id = ?1",
                            [&event.fingerprint],
                            |row| row.get(0)
                        ).unwrap_or(0) == 1;

                        if is_suppressed {
                            // Only update the counter, skip event details
                            if let Err(e) = tx.execute(
                                "UPDATE issues SET count = count + 1, last_seen = ?2 WHERE id = ?1",
                                rusqlite::params![event.fingerprint, event.timestamp.to_rfc3339()]
                            ) {
                                let err_msg = format!("Failed to update suppressed issue: {:?}", e);
                                eprintln!("[DB WORKER ERROR] {}", err_msg);
                                db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.fingerprint));
                            }
                            continue;
                        }

                        let rpm = *event_rpms.get(&event.id).unwrap_or(&0);

                        // Circuit Breaker: If > 100 RPM, just count it and skip payload/event storage
                        if rpm > 100 {
                            if let Err(e) = tx.execute(
                                "UPDATE issues SET count = count + 1, last_seen = ?2 WHERE id = ?1",
                                rusqlite::params![event.fingerprint, event.timestamp.to_rfc3339()]
                            ) {
                                let err_msg = format!("Failed to update circuit breaker issue: {:?}", e);
                                eprintln!("[DB WORKER ERROR] {}", err_msg);
                                db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.fingerprint));
                            }
                            continue;
                        }

                        let original_size = event.payload.len();
                        if let Err(e) = tx.execute(
                            "INSERT OR IGNORE INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![
                                event.payload_hash,
                                event.payload,
                                original_size as i64,
                                original_size as i64
                            ]
                        ) {
                            let err_msg = format!("Failed to insert payload: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.payload_hash));
                            success = false;
                        }

                        let stack_hash = calculate_hash(event.fingerprint.as_bytes());
                        if let Err(e) = tx.execute(
                            "INSERT OR IGNORE INTO stack_traces (hash, normalized) VALUES (?1, ?2)",
                            rusqlite::params![stack_hash, event.fingerprint]
                        ) {
                            let err_msg = format!("Failed to insert stack trace: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.fingerprint));
                            success = false;
                        }

                        let issue_id: String = tx.query_row(
                            "INSERT INTO issues (id, title, culprit, status, count, users_affected, last_seen, is_suppressed)
                             VALUES (?1, ?2, ?3, 'unhandled', 1, 1, ?4, 0)
                             ON CONFLICT(id) DO UPDATE SET
                                 count = count + 1,
                                 last_seen = ?4
                             RETURNING id",
                            rusqlite::params![
                                event.fingerprint,
                                event.title.as_deref().unwrap_or("Error"),
                                event.culprit.as_deref().unwrap_or("unknown"),
                                event.timestamp.to_rfc3339(),
                            ],
                            |row| row.get(0),
                        ).unwrap_or_else(|err| {
                            let err_msg = format!("Failed to insert or update issue: {:?}", err);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.fingerprint));
                            success = false;
                            event.fingerprint.clone()
                        });

                        if let Err(e) = tx.execute(
                            "INSERT INTO events (id, issue_id, timestamp, event_type, hwid, ip_address, os, browser, region, release_version, environment, stack_hash, payload_hash, title)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                            rusqlite::params![
                                event.id.to_string(), issue_id, event.timestamp.to_rfc3339(),
                                event.event_type, event.hwid, event.ip_address, event.os, event.browser,
                                event.region, event.release_version, event.environment,
                                stack_hash, event.payload_hash, event.title
                            ],
                        ) {
                            let err_msg = format!("Failed to insert event details: {:?}", e);
                            eprintln!("[DB WORKER ERROR] {}", err_msg);
                            db_manager.log_internal_error("ingest_worker", &err_msg, Some(&event.id.to_string()));
                            success = false;
                        }
                    }
                }

                let affected_issue_ids: std::collections::HashSet<String> = events.iter()
                    .filter(|e| e.event_type != "posthog")
                    .map(|e| e.fingerprint.clone())
                    .collect();
                
                for issue_id in affected_issue_ids {
                    if let Err(e) = tx.execute(
                        "UPDATE issues SET users_affected = (
                            SELECT COUNT(DISTINCT hwid) FROM events
                            WHERE events.issue_id = ?1 AND hwid IS NOT NULL
                         ) WHERE id = ?1",
                        [&issue_id],
                    ) {
                        let err_msg = format!("Failed to update affected users: {:?}", e);
                        eprintln!("[DB WORKER ERROR] {}", err_msg);
                        db_manager.log_internal_error("ingest_worker", &err_msg, Some(&issue_id));
                    }
                }
                
                if success {
                    if let Err(e) = tx.commit() {
                        let err_msg = format!("Failed to commit transactional batch: {:?}", e);
                        eprintln!("[DB WORKER ERROR] {}", err_msg);
                        db_manager.log_internal_error("ingest_worker", &err_msg, None);
                        metrics.db_flushes_failed.fetch_add(1, Ordering::Relaxed);
                    } else {
                        println!("[DB WORKER] Successfully flushed transaction batch of {} events to database.", events.len());
                        metrics.db_flushes_success.fetch_add(1, Ordering::Relaxed);
                    }
                } else {
                    let err_msg = "Skipped transactional batch commit due to intermediate database errors.";
                    eprintln!("[DB WORKER ERROR] {}", err_msg);
                    db_manager.log_internal_error("ingest_worker", err_msg, None);
                    metrics.db_flushes_failed.fetch_add(1, Ordering::Relaxed);
                }
            } else {
                let err_msg = "Failed to initialize SQLite transaction.";
                eprintln!("[DB WORKER ERROR] {}", err_msg);
                db_manager.log_internal_error("ingest_worker", err_msg, None);
                metrics.db_flushes_failed.fetch_add(1, Ordering::Relaxed);
            }
            
            let proj_cache = db_manager.get_project_cache(&project_id);
            proj_cache.invalidate("issues_summary").await;
            proj_cache.invalidate("event_counts").await;
            db_manager.invalidate_dashboard_cache(&project_id).await;
        } else {
            let err_msg = format!("Failed to acquire connection from pool for project: {}", project_id);
            eprintln!("[DB WORKER ERROR] {}", err_msg);
            db_manager.log_internal_error("ingest_worker", &err_msg, None);
            metrics.db_flushes_failed.fetch_add(1, Ordering::Relaxed);
        }
    }
}
