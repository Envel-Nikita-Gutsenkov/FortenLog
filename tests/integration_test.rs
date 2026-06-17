use axum::{
    body::Body,
    http::{Request, StatusCode},
    extract::connect_info::ConnectInfo,
};
use tower::ServiceExt;
use forten_log::handlers::ingest::{AppState, sentry_envelope};
use forten_log::db::DbManager;
use std::sync::Arc;
use std::net::SocketAddr;
use tokio::sync::mpsc;


#[tokio::test]
async fn test_sentry_ingestion_endpoint() {
    let (tx, _rx) = mpsc::channel(100);
    let (session_tx, _session_rx) = mpsc::channel(100);
    
    // Clean up test data directory to ensure a clean run
    let test_dir = "./test_data_integration";
    let _ = std::fs::remove_dir_all(test_dir);

    let db_manager = Arc::new(DbManager::new(test_dir).unwrap());
    
    // Insert project '1' to satisfy the existence check
    {
        let conn = db_manager.get_system_conn().unwrap();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('1', 'Test Project', 'fl_test')",
            [],
        );
    }

    let state = Arc::new(AppState {
        ingest_tx: tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(10_000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let app = axum::Router::new()
        .route("/api/:project_id/envelope/", axum::routing::post(sentry_envelope))
        .with_state(state);

    let addr: SocketAddr = "127.0.0.1:12345".parse().unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/1/envelope/?sentry_key=fl_test")
                .header("content-type", "application/x-sentry-envelope")
                .extension(ConnectInfo(addr))
                .body(Body::from("{} \n {\"message\": \"test error\"}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Clean up
    let _ = std::fs::remove_dir_all(test_dir);
}

#[tokio::test]
async fn test_posthog_ingestion_endpoint() {
    let (tx, _rx) = mpsc::channel(100);
    let (session_tx, _session_rx) = mpsc::channel(100);
    
    // Clean up test data directory to ensure a clean run
    let test_dir = "./test_data_posthog_integration";
    let _ = std::fs::remove_dir_all(test_dir);

    let db_manager = Arc::new(DbManager::new(test_dir).unwrap());
    
    // Insert project 'test-proj' with API key 'fl_posthog_key'
    {
        let conn = db_manager.get_system_conn().unwrap();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('test-proj', 'PostHog Project', 'fl_posthog_key')",
            [],
        );
    }

    let state = Arc::new(AppState {
        ingest_tx: tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(10_000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let app = axum::Router::new()
        .route("/capture", axum::routing::post(forten_log::handlers::ingest::posthog_capture))
        .with_state(state);

    let addr: SocketAddr = "127.0.0.1:12345".parse().unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/capture")
                .header("content-type", "application/json")
                .extension(ConnectInfo(addr))
                .body(Body::from(serde_json::json!({
                    "api_key": "fl_posthog_key",
                    "event": "$pageview",
                    "properties": {
                        "distinct_id": "user123",
                        "$os": "Windows",
                        "$browser": "Chrome"
                    }
                }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    // Clean up
    let _ = std::fs::remove_dir_all(test_dir);
}

#[tokio::test]
async fn test_custom_query_endpoint() {
    let (tx, _rx) = mpsc::channel(100);
    let (session_tx, _session_rx) = mpsc::channel(100);
    
    let test_dir = "./test_data_query_integration";
    let _ = std::fs::remove_dir_all(test_dir);

    let db_manager = Arc::new(DbManager::new(test_dir).unwrap());
    
    // Insert project 'proj1'
    {
        let conn = db_manager.get_system_conn().unwrap();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('proj1', 'Query Project', 'key1')",
            [],
        );
        
        // Initialize project pool and insert some mock events
        let pool = db_manager.get_project_pool("proj1").unwrap();
        let conn = pool.get().unwrap();
        let _ = conn.execute(
            "INSERT INTO events (id, os, browser, environment) VALUES ('e1', 'Windows', 'Chrome', 'production')",
            [],
        );
        let _ = conn.execute(
            "INSERT INTO events (id, os, browser, environment) VALUES ('e2', 'Windows', 'Firefox', 'production')",
            [],
        );
        let _ = conn.execute(
            "INSERT INTO events (id, os, browser, environment) VALUES ('e3', 'Linux', 'Chrome', 'development')",
            [],
        );
    }

    let state = Arc::new(AppState {
        ingest_tx: tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(10_000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let app = axum::Router::new()
        .route("/api/dashboard/query", axum::routing::post(forten_log::handlers::dashboard::execute_custom_query))
        .with_state(state);

    // 1. Valid Query Test: Group events by 'os' with filter environment = 'production'
    let response1 = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/dashboard/query")
                .header("content-type", "application/json")
                .extension(forten_log::handlers::auth::Claims {
                    sub: "admin".to_string(),
                    is_admin: true,
                    session_id: "test-sess".to_string(),
                    password_change_required: false,
                })
                .body(Body::from(serde_json::json!({
                    "project_id": "proj1",
                    "table": "events",
                    "metric": "count",
                    "dimension": "os",
                    "filters": [
                        { "column": "environment", "op": "eq", "value": "production" }
                    ]
                }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response1.status(), StatusCode::OK);
    
    // Parse response
    let body_bytes = axum::body::to_bytes(response1.into_body(), 10000).await.unwrap();
    let json_data: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    
    let arr = json_data.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "Windows");
    assert_eq!(arr[0]["count"], 2);

    // 2. Invalid Query Test: Non-whitelisted column/table (SQL Injection attempt)
    let response2 = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/dashboard/query")
                .header("content-type", "application/json")
                .extension(forten_log::handlers::auth::Claims {
                    sub: "admin".to_string(),
                    is_admin: true,
                    session_id: "test-sess".to_string(),
                    password_change_required: false,
                })
                .body(Body::from(serde_json::json!({
                    "project_id": "proj1",
                    "table": "users; DROP TABLE events; --",
                    "metric": "count",
                    "dimension": "os"
                }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response2.status(), StatusCode::BAD_REQUEST);

    // Clean up
    let _ = std::fs::remove_dir_all(test_dir);
}

#[tokio::test]
async fn test_issue_id_with_special_characters() {
    let (tx, _rx) = mpsc::channel(100);
    let (session_tx, _session_rx) = mpsc::channel(100);
    
    let test_dir = "./test_data_special_chars";
    let _ = std::fs::remove_dir_all(test_dir);

    let db_manager = Arc::new(DbManager::new(test_dir).unwrap());
    
    let issue_id = "demo-ConnectionTimeoutError-Failed to acquire a database connection after 30000ms. Active connections: 50/50.";
    
    // Insert project 'proj1' and the issue with special characters
    {
        let conn = db_manager.get_system_conn().unwrap();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('proj1', 'Special Project', 'key1')",
            [],
        );
        
        let pool = db_manager.get_project_pool("proj1").unwrap();
        let conn = pool.get().unwrap();
        let _ = conn.execute(
            "INSERT INTO issues (id, title, culprit, status, count, users_affected, last_seen, is_suppressed)
             VALUES (?1, 'Error: timeout', 'main.rs', 'unhandled', 1, 1, '2026-06-15T12:00:00Z', 0)",
            [issue_id],
        );
    }

    let state = Arc::new(AppState {
        ingest_tx: tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(10_000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let app = axum::Router::new()
        .route("/api/projects/:project_id/issues/:id", axum::routing::get(forten_log::handlers::issues::get_issue_detail))
        .with_state(state);

    // Double-encoded version of "demo-ConnectionTimeoutError-Failed to acquire a database connection after 30000ms. Active connections: 50/50."
    let encoded_id = "demo-ConnectionTimeoutError-Failed%2520to%2520acquire%2520a%2520database%2520connection%2520after%252030000ms.%2520Active%2520connections%253A%252050%252F50.";
    let uri = format!("/api/projects/proj1/issues/{}", encoded_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&uri)
                .extension(forten_log::handlers::auth::Claims {
                    sub: "admin".to_string(),
                    is_admin: true,
                    session_id: "test-sess".to_string(),
                    password_change_required: false,
                })
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Clean up
    let _ = std::fs::remove_dir_all(test_dir);
}

#[tokio::test]
async fn test_empty_sentry_envelope() {
    let (tx, _rx) = mpsc::channel(100);
    let (session_tx, _session_rx) = mpsc::channel(100);
    
    let test_dir = "./test_data_empty_env";
    let _ = std::fs::remove_dir_all(test_dir);

    let db_manager = Arc::new(DbManager::new(test_dir).unwrap());
    
    // Insert project '1' to satisfy the existence check
    {
        let conn = db_manager.get_system_conn().unwrap();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('1', 'Test Project', 'fl_test')",
            [],
        );
    }

    let state = Arc::new(AppState {
        ingest_tx: tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(10_000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder().build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let app = axum::Router::new()
        .route("/api/:project_id/envelope/", axum::routing::post(sentry_envelope))
        .with_state(state);

    let addr: SocketAddr = "127.0.0.1:12345".parse().unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/1/envelope/?sentry_key=fl_test")
                .header("content-type", "application/x-sentry-envelope")
                .extension(ConnectInfo(addr))
                .body(Body::from("   \n   ")) // Empty body (only whitespace)
                .unwrap(),
        )
        .await
        .unwrap();

    // Verify it is rejected with BAD_REQUEST
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    
    // Clean up
    let _ = std::fs::remove_dir_all(test_dir);
}
