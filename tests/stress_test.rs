use axum::{
    body::Body,
    http::{Request, StatusCode},
    extract::connect_info::ConnectInfo,
};
use tower::ServiceExt;
use forten_log::handlers::ingest::{AppState, posthog_capture, sentry_envelope, IngestionPerformanceMetrics};
use forten_log::db::DbManager;
use forten_log::handlers::maintenance::perform_compression;
use std::sync::Arc;
use std::net::SocketAddr;
use tokio::sync::mpsc;


#[tokio::test]
#[ignore]
async fn test_comprehensive_stress_and_lifecycle() {
    let test_dir = std::env::temp_dir().join(format!("forten_log_stress_lifecycle_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_dir_all(&test_dir);

    let db_manager = Arc::new(DbManager::new(&test_dir).unwrap());
    
    // Seed project
    let project_id = "stress-proj";
    let api_key = "stress_key_123";
    {
        let conn = db_manager.get_system_conn().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, api_key, cache_size_mb) VALUES (?1, 'Stress Project', ?2, 16)",
            [project_id, api_key],
        ).unwrap();
    }

    // Initialize channels and state
    let (ingest_tx, ingest_rx) = mpsc::channel(10000);
    let (session_tx, _session_rx) = mpsc::channel(1000);
    let stack_cache = moka::sync::Cache::builder().max_capacity(100_000).time_to_live(std::time::Duration::from_secs(3600)).build();
    let ip_rate_limit = moka::future::Cache::builder().build();
    let ingest_rate_limit_10m = moka::future::Cache::builder().build();
    let ingest_rate_limit_day = moka::future::Cache::builder().build();
    let issue_rpm_cache = moka::future::Cache::builder().build();
    let metrics = Arc::new(IngestionPerformanceMetrics::new());

    let state = Arc::new(AppState {
        ingest_tx: ingest_tx.clone(),
        session_tx,
        stack_cache,
        ip_rate_limit,
        ingest_rate_limit_10m,
        ingest_rate_limit_day,
        issue_rpm_cache: issue_rpm_cache.clone(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager: db_manager.clone(),
        auth_config: forten_log::middleware::auth::AuthConfig {
            allowed_ips: vec!["*".into()],
            stealth_mode: false,
        },
        metrics: metrics.clone(),
    });

    // Start background ingestion worker
    let db_manager_clone = db_manager.clone();
    let issue_rpm_cache_clone = issue_rpm_cache.clone();
    let metrics_clone = metrics.clone();
    tokio::spawn(async move {
        forten_log::handlers::ingest::worker::ingestion_worker(
            ingest_rx,
            db_manager_clone,
            500, // batch_size
            1,   // batch_interval_secs (flush quickly)
            issue_rpm_cache_clone,
            metrics_clone,
        ).await;
    });

    let app = axum::Router::new()
        .route("/capture", axum::routing::post(posthog_capture))
        .route("/api/:project_id/envelope/", axum::routing::post(sentry_envelope))
        .with_state(state.clone());

    let addr: SocketAddr = "127.0.0.1:23456".parse().unwrap();

    // ==========================================
    // 1. Spam Deduplication Test (1 user, same error)
    // Send 10 events with same fingerprint/user distinct_id,
    // verify only 1 event is added to the events table, but issue count is 10.
    // ==========================================
    println!("[TEST] Simulating user spam deduplication...");
    for _ in 0..10 {
        state.ingest_rate_limit_10m.invalidate_all();
        state.ingest_rate_limit_day.invalidate_all();
        let req = Request::builder()
            .method("POST")
            .uri("/api/stress-proj/envelope/?sentry_key=stress_key_123")
            .header("content-type", "application/json")
            .extension(ConnectInfo(addr))
            .body(Body::from(serde_json::json!({
                "exception": {
                    "values": [{
                        "type": "test_spam_event",
                        "value": "user_spam_1"
                    }]
                }
            }).to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // Wait for worker batch flush
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    // Check project database
    let pool = db_manager.get_project_pool(project_id).unwrap();
    let conn = pool.get().unwrap();
    let event_count: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
    let issue_count: i64 = conn.query_row("SELECT count FROM issues WHERE id = 'stress-proj-test_spam_event-user_spam_1'", [], |r| r.get(0)).unwrap();

    println!("[TEST] Spam deduplication results -> event_count: {}, issue_count: {}", event_count, issue_count);
    assert_eq!(event_count, 1, "Only one event should be stored due to user spam cache");
    assert_eq!(issue_count, 10, "The issue count should be updated to 10");

    // ==========================================
    // 2. Circuit Breaker Test (RPM > 100)
    // Directly simulate >100 RPM for a fingerprint in issue_rpm_cache.
    // Send 5 events and verify they don't produce event logs, but update issue count.
    // ==========================================
    println!("[TEST] Simulating Ingestion Circuit Breaker...");
    let cb_fingerprint = format!("{}-cb_event-cb_user", project_id);
    
    // Seed initial issue for UPDATE in circuit breaker
    conn.execute(
        "INSERT INTO issues (id, title, culprit, status, count, users_affected, last_seen, is_suppressed)
         VALUES (?1, 'cb_event: cb_user', 'unknown', 'unhandled', 0, 1, date('now'), 0)",
        [&cb_fingerprint],
    ).unwrap();

    issue_rpm_cache.insert(cb_fingerprint.clone(), 150).await;

    for _ in 0..5 {
        state.ingest_rate_limit_10m.invalidate_all();
        state.ingest_rate_limit_day.invalidate_all();
        let req = Request::builder()
            .method("POST")
            .uri("/api/stress-proj/envelope/?sentry_key=stress_key_123")
            .header("content-type", "application/json")
            .extension(ConnectInfo(addr))
            .body(Body::from(serde_json::json!({
                "exception": {
                    "values": [{
                        "type": "cb_event",
                        "value": "cb_user"
                    }]
                }
            }).to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // Wait for worker batch flush
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    let total_events: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE title = 'cb_event: cb_user'", [], |r| r.get(0)).unwrap();
    let issue_count_cb: i64 = conn.query_row("SELECT count FROM issues WHERE id = ?1", [cb_fingerprint], |r| r.get(0)).unwrap();

    println!("[TEST] Circuit breaker results -> cb_events_stored: {}, cb_issue_count: {}", total_events, issue_count_cb);
    assert_eq!(total_events, 0, "No event rows should be stored when Circuit Breaker is active (>100 RPM)");
    assert_eq!(issue_count_cb, 5, "Issue count should still be incremented to 5");

    // ==========================================
    // 3. Storage Retention & Purging Lifecycle
    // - Insert old PostHog event (15 days ago)
    // - Insert resolved old event (15 months ago)
    // - Verify perform_compression prunes them correctly.
    // ==========================================
    println!("[TEST] Setting up data for retention & purge lifecycle tests...");
    
    // Insert posthog event with hash and payload (35 days ago)
    let hash_15d = "hash_15_days_ago";
    let payload_15d = zstd::stream::encode_all(&b"{\"event\":\"posthog_15d_payload\"}"[..], 3).unwrap();
    conn.execute(
        "INSERT INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, 30, 30)",
        rusqlite::params![hash_15d, payload_15d],
    ).unwrap();
    conn.execute(
        "INSERT INTO events (id, timestamp, event_type, payload_hash) VALUES ('ev_15d', date('now', '-35 days'), 'posthog', ?1)",
        [hash_15d],
    ).unwrap();

    // Insert resolved issue events (15 months ago, approx 450 days)
    let issue_resolved_id = "resolved_issue_id";
    conn.execute(
        "INSERT INTO issues (id, title, culprit, status, count, users_affected, last_seen, is_suppressed)
         VALUES (?1, 'Resolved Issue', 'culprit', date('now', '-450 days'), 1, 1, date('now', '-450 days'), 0)",
        [issue_resolved_id],
    ).unwrap();

    let hash_15m = "hash_15_months_ago";
    let payload_15m = zstd::stream::encode_all(&b"{\"error\":\"resolved_15m_payload\"}"[..], 3).unwrap();
    conn.execute(
        "INSERT INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, 30, 30)",
        rusqlite::params![hash_15m, payload_15m],
    ).unwrap();
    conn.execute(
        "INSERT INTO events (id, timestamp, event_type, payload_hash, issue_id) VALUES ('ev_15m', date('now', '-450 days'), 'error', ?1, ?2)",
        rusqlite::params![hash_15m, issue_resolved_id],
    ).unwrap();

    // Ensure they exist before running compression
    let count_before_purge: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE id = 'ev_15d'", [], |r| r.get(0)).unwrap();
    assert_eq!(count_before_purge, 1);

    println!("[TEST] Executing database compression and purging...");
    perform_compression(&db_manager);

    // Assertions:
    // 1. PostHog event (15d ago) payload_hash should be set to NULL (GDPR payload removal)
    let payload_hash_15d: Option<String> = conn.query_row(
        "SELECT payload_hash FROM events WHERE id = 'ev_15d'",
        [],
        |r| r.get(0),
    ).unwrap();
    assert!(payload_hash_15d.is_none(), "GDPR cleanup: PostHog event payload_hash should be NULL");

    // 2. Resolved issue event (15m ago) should be completely deleted
    let count_15m: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE id = 'ev_15m'",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count_15m, 0, "Resolved issue events older than retention limit should be deleted");

    // 3. Orphaned payloads (for deleted event `ev_15m` and cleared `ev_15d`) should be purged
    let payload_exists_15d: i64 = conn.query_row("SELECT COUNT(*) FROM payloads WHERE hash = ?1", [hash_15d], |r| r.get(0)).unwrap();
    let payload_exists_15m: i64 = conn.query_row("SELECT COUNT(*) FROM payloads WHERE hash = ?1", [hash_15m], |r| r.get(0)).unwrap();
    assert_eq!(payload_exists_15d, 0, "Orphaned payload for 15d GDPR event should be deleted");
    assert_eq!(payload_exists_15m, 0, "Orphaned payload for 15m deleted event should be deleted");

    println!("[TEST] All stress and lifecycle tests passed successfully!");

    // Clean up
    let _ = std::fs::remove_dir_all(&test_dir);
}
