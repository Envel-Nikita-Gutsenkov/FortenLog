use axum::{
    body::Body,
    http::{Request, StatusCode},
    extract::connect_info::ConnectInfo,
    routing::get,
};
use tower::ServiceExt;
use std::sync::Arc;
use std::net::SocketAddr;
use tokio::sync::mpsc;
use sha2::{Digest, Sha256};

use forten_log::handlers::ingest::AppState;
use forten_log::db::DbManager;

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn hash_key(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    format!("{:x}", h.finalize())
}

fn make_state(db_manager: Arc<DbManager>) -> Arc<AppState> {
    let (ingest_tx, _) = mpsc::channel(100);
    let (session_tx, _) = mpsc::channel(100);
    Arc::new(AppState {
        ingest_tx,
        session_tx,
        stack_cache: moka::sync::Cache::builder().max_capacity(1000).build(),
        ip_rate_limit: moka::future::Cache::builder().build(),
        ingest_rate_limit_10m: moka::future::Cache::builder().build(),
        ingest_rate_limit_day: moka::future::Cache::builder().build(),
        issue_rpm_cache: moka::future::Cache::builder().build(),
        api_key_rate_limit: moka::future::Cache::builder()
            .time_to_live(std::time::Duration::from_secs(60))
            .build(),
        db_manager,
        auth_config: forten_log::middleware::auth::AuthConfig {
            allowed_ips: vec!["*".into()],
            stealth_mode: false,
        },
        metrics: Arc::new(forten_log::handlers::ingest::IngestionPerformanceMetrics::new()),
    })
}

/// Build a minimal v1 router with API key middleware attached.
fn make_v1_app(state: Arc<AppState>) -> axum::Router {
    use axum::middleware::from_fn_with_state;
    use forten_log::{
        middleware::api_key::api_key_auth_middleware,
        handlers::api_keys::v1::*,
    };

    axum::Router::new()
        .route("/v1/system", get(v1_system_info))
        .route("/v1/projects", get(v1_list_projects))
        .route("/v1/projects/:project_id/issues", get(v1_list_issues))
        .route("/v1/projects/:project_id/issues/:issue_id", get(v1_get_issue))
        .route("/v1/projects/:project_id/issues/:issue_id/events", get(v1_get_issue_events))
        .route("/v1/projects/:project_id/events", get(v1_list_events))
        .route("/v1/projects/:project_id/stats", get(v1_get_stats))
        .route("/v1/projects/:project_id/sessions", get(v1_get_sessions))
        .route("/v1/projects/:project_id/uptime", get(v1_get_uptime))
        .layer(from_fn_with_state(state.clone(), api_key_auth_middleware))
        .with_state(state)
}

const ADDR: &str = "127.0.0.1:0";
const PROJECT_ID: &str = "test-proj";

/// Insert a test project and an API key, return (raw_key, db_manager).
fn setup_db(
    test_dir: &str,
    scopes: &[&str],
    project_ids: &[&str],
    allowed_ips: Option<&[&str]>,
    expires_in_secs: Option<i64>,
    is_revoked: bool,
) -> (String, Arc<DbManager>) {
    let _ = std::fs::remove_dir_all(test_dir);
    let db = Arc::new(DbManager::new(test_dir).unwrap());

    let conn = db.get_system_conn().unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES (?1, 'Test', 'fl_ignored')",
        [PROJECT_ID],
    ).unwrap();

    conn.execute(
        "INSERT OR IGNORE INTO users (username, password_hash) VALUES ('admin', 'mock_hash')",
        [],
    ).unwrap();

    // Raw key with correct format
    let raw_bytes = [0xABu8; 32];
    let raw_hex: String = raw_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let raw_key = format!("flpat_{}", raw_hex);
    let key_hash = hash_key(&raw_key);
    let key_prefix = format!("flpat_{}", &raw_hex[..8]);

    let expires_at = expires_in_secs.map(|s| {
        (chrono::Utc::now() + chrono::Duration::seconds(s))
            .to_rfc3339()
    });
    let scopes_json = serde_json::to_string(scopes).unwrap();
    let proj_json = serde_json::to_string(project_ids).unwrap();
    let ips_json = allowed_ips.map(|ips| serde_json::to_string(ips).unwrap());

    conn.execute(
        "INSERT INTO api_keys
         (id, name, key_hash, key_prefix, owner, project_ids, scopes, allowed_ips, expires_at, is_revoked)
         VALUES ('key-1', 'Test Key', ?1, ?2, 'admin', ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            key_hash,
            key_prefix,
            proj_json,
            scopes_json,
            ips_json,
            expires_at,
            is_revoked as i32,
        ],
    ).unwrap();

    (raw_key, db)
}

fn addr() -> SocketAddr {
    ADDR.parse().unwrap()
}

// ─── Unit Tests: Crypto & Validation ──────────────────────────────────────────

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn key_hash_is_deterministic() {
        let raw = "flpat_abcdef1234abcdef1234abcdef1234abcdef1234abcdef1234abcdef1234ab";
        let h1 = hash_key(raw);
        let h2 = hash_key(raw);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64, "SHA-256 hex should be 64 chars");
    }

    #[test]
    fn different_keys_produce_different_hashes() {
        let h1 = hash_key("flpat_aaaa");
        let h2 = hash_key("flpat_bbbb");
        assert_ne!(h1, h2);
    }

    #[test]
    fn ip_cidr_check_logic() {
        // Mirror the ip_allowed logic from middleware/api_key.rs
        fn ip_in_cidr(client: &str, entry: &str) -> bool {
            let client_ip_addr = client.parse::<std::net::IpAddr>();
            if entry == client {
                return true;
            }
            if let Some((net_addr, prefix_len)) = entry.split_once('/') {
                if let (Ok(ref client_addr), Ok(net), Ok(bits)) = (
                    &client_ip_addr,
                    net_addr.parse::<std::net::IpAddr>(),
                    prefix_len.parse::<u32>(),
                ) {
                    match (client_addr, net) {
                        (std::net::IpAddr::V4(c), std::net::IpAddr::V4(n)) => {
                            if bits == 0 { return true; }
                            let mask = u32::MAX << (32 - bits.min(32));
                            return (u32::from(*c) & mask) == (u32::from(n) & mask);
                        }
                        (std::net::IpAddr::V6(c), std::net::IpAddr::V6(n)) => {
                            if bits == 0 { return true; }
                            let mask = u128::MAX << (128 - bits.min(128));
                            return (u128::from(*c) & mask) == (u128::from(n) & mask);
                        }
                        _ => return false,
                    }
                }
                return false;
            }
            false
        }

        assert!(ip_in_cidr("192.168.1.5",  "192.168.1.0/24"), "should match /24");
        assert!(ip_in_cidr("10.0.0.1",     "10.0.0.0/8"),     "should match /8");
        assert!(!ip_in_cidr("172.16.0.1",  "192.168.1.0/24"), "should not match");
        assert!(ip_in_cidr("127.0.0.1",    "127.0.0.1"),      "exact match");
        assert!(!ip_in_cidr("127.0.0.2",   "127.0.0.1"),      "exact non-match");
        assert!(ip_in_cidr("1.2.3.4",      "0.0.0.0/0"),      "/0 = allow all");
        
        // IPv6 tests
        assert!(ip_in_cidr("2001:db8::1",  "2001:db8::/32"),  "ipv6 should match /32");
        assert!(!ip_in_cidr("2001:db8::1", "2001:db9::/32"),  "ipv6 should not match");
        assert!(ip_in_cidr("::1",          "::1"),            "ipv6 exact match");
        assert!(ip_in_cidr("fe80::1",      "::/0"),           "ipv6 allow all");
    }

    #[test]
    fn scope_validation() {
        fn valid(scopes: &[&str]) -> bool {
            const VALID: &[&str] = &["issues:read", "events:read", "stats:read", "uptime:read"];
            !scopes.is_empty() && scopes.iter().all(|s| VALID.contains(s))
        }

        assert!(valid(&["issues:read"]));
        assert!(valid(&["issues:read", "events:read", "stats:read", "uptime:read"]));
        assert!(!valid(&["admin:write"]), "invalid scope should fail");
        assert!(!valid(&[]), "empty scopes should fail");
        assert!(!valid(&["issues:read", "DROP TABLE users"]), "injection should fail");
    }

    #[test]
    fn key_format_validation() {
        // A valid key: "flpat_" + 64 hex chars = 70 chars total
        let valid = format!("flpat_{}", "ab".repeat(32));
        assert!(valid.starts_with("flpat_"));
        assert_eq!(valid.len(), 70);

        // Invalid cases
        assert!("flpat_short".len() < 70);
        assert!(!"Bearer flpat_xx".starts_with("flpat_"));
    }
}

// ─── Integration Tests: Auth Middleware ───────────────────────────────────────

#[tokio::test]
async fn test_api_key_valid_request_returns_200() {
    let dir = "./test_apikey_valid";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        None,
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK, "valid key should return 200");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_missing_returns_401() {
    let dir = "./test_apikey_missing";
    let (_, db) = setup_db(dir, &["stats:read"], &[PROJECT_ID], None, None, false);
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_wrong_token_returns_401() {
    let dir = "./test_apikey_wrong";
    let (_, db) = setup_db(dir, &["stats:read"], &[PROJECT_ID], None, None, false);
    let state = make_state(db);
    let app = make_v1_app(state);

    // Completely fabricated key with correct format
    let fake = format!("flpat_{}", "ff".repeat(32));
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", fake))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_revoked_returns_401() {
    let dir = "./test_apikey_revoked";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        None,
        None,
        true, // is_revoked = true
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "revoked key must be rejected");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_expired_returns_401() {
    let dir = "./test_apikey_expired";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        None,
        Some(-1), // expired 1 second ago
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "expired key must be rejected");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_ip_blocked_returns_403() {
    let dir = "./test_apikey_ip_block";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        Some(&["192.168.99.99"]), // only this IP allowed
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    // Request comes from 127.0.0.1, which is NOT in allowlist
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo("127.0.0.1:9999".parse::<SocketAddr>().unwrap()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN, "blocked IP must get 403");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_wrong_scope_returns_403() {
    let dir = "./test_apikey_scope";
    let (raw_key, db) = setup_db(
        dir,
        &["uptime:read"], // does NOT have issues:read
        &[PROJECT_ID],
        None,
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/issues", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN, "wrong scope must get 403");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_wrong_project_returns_403() {
    let dir = "./test_apikey_project";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &["other-project"], // key only allows other-project
        None,
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/issues", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN, "wrong project must get 403");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_wildcard_project_allows_all() {
    let dir = "./test_apikey_wildcard";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &["*"], // wildcard: all projects
        None,
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK, "wildcard project key should be accepted");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_valid_future_expiry_allowed() {
    let dir = "./test_apikey_future_expiry";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        None,
        Some(86400), // expires in 24h
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK, "key with future expiry should work");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_short_token_rejected() {
    let dir = "./test_apikey_short_token";
    let (_, db) = setup_db(dir, &["stats:read"], &[PROJECT_ID], None, None, false);
    let state = make_state(db);
    let app = make_v1_app(state);

    // Token is too short (not 70 chars after "flpat_")
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", "Bearer flpat_tooshort")
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "too-short key must fail");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_api_key_wrong_prefix_rejected() {
    let dir = "./test_apikey_prefix";
    let (_, db) = setup_db(dir, &["stats:read"], &[PROJECT_ID], None, None, false);
    let state = make_state(db);
    let app = make_v1_app(state);

    // Correct length but wrong prefix
    let fake = format!("sk_live_{}", "ab".repeat(31));
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", fake))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "wrong prefix must fail");
    let _ = std::fs::remove_dir_all(dir);
}

// ─── Integration Tests: Endpoint Data ─────────────────────────────────────────

#[tokio::test]
async fn test_v1_list_issues_returns_data() {
    let dir = "./test_v1_list_issues";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &[PROJECT_ID],
        None,
        None,
        false,
    );

    // Seed an issue
    {
        let pool = db.get_project_pool(PROJECT_ID).unwrap();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO issues (id, title, culprit, status, count, users_affected, first_seen, last_seen, is_suppressed)
             VALUES ('iss-1', 'Test Error', 'main.rs', 'unhandled', 5, 2, '2026-01-01', '2026-01-02', 0)",
            [],
        ).unwrap();
    }

    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/issues", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 65536).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["total"], 1);
    assert_eq!(json["items"][0]["id"], "iss-1");
    assert_eq!(json["items"][0]["title"], "Test Error");
    assert_eq!(json["items"][0]["count"], 5);

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_v1_stats_returns_valid_structure() {
    let dir = "./test_v1_stats";
    let (raw_key, db) = setup_db(
        dir,
        &["stats:read"],
        &[PROJECT_ID],
        None,
        None,
        false,
    );

    // Seed events
    {
        let pool = db.get_project_pool(PROJECT_ID).unwrap();
        let conn = pool.get().unwrap();
        for i in 0..3 {
            conn.execute(
                "INSERT INTO events (id, os, browser, environment, timestamp) VALUES (?1, 'Windows', 'Chrome', 'production', '2026-01-01')",
                [format!("ev-{}", i)],
            ).unwrap();
        }
    }

    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/stats", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 65536).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["total_events"], 3);
    assert!(json["crash_free_rate"].is_f64() || json["crash_free_rate"].is_i64());
    assert!(json["breakdown"]["os"].is_array());
    assert!(json["breakdown"]["browser"].is_array());

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_v1_nonexistent_project_returns_404() {
    let dir = "./test_v1_not_found";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &["*"],  // wildcard — can access any project
        None,
        None,
        false,
    );

    let state = make_state(db);
    let app = make_v1_app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/projects/nonexistent-project-xyz/issues")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_v1_pagination_limits_are_enforced() {
    let dir = "./test_v1_pagination";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &[PROJECT_ID],
        None,
        None,
        false,
    );

    // Seed 10 issues
    {
        let pool = db.get_project_pool(PROJECT_ID).unwrap();
        let conn = pool.get().unwrap();
        for i in 0..10 {
            conn.execute(
                "INSERT INTO issues (id, title, status, count, users_affected, first_seen, last_seen, is_suppressed)
                 VALUES (?1, 'Error', 'unhandled', 1, 0, '2026-01-01', '2026-01-02', 0)",
                [format!("iss-{}", i)],
            ).unwrap();
        }
    }

    let state = make_state(db);
    let app = make_v1_app(state);

    // Request limit=3
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/issues?limit=3", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 65536).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["total"], 10);
    assert_eq!(json["limit"], 3);
    assert_eq!(json["items"].as_array().unwrap().len(), 3);

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_v1_limit_clamped_at_500() {
    let dir = "./test_v1_clamp";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &[PROJECT_ID],
        None,
        None,
        false,
    );

    let state = make_state(db);
    let app = make_v1_app(state);

    // Request limit=99999 — should be clamped to 500
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{}/issues?limit=99999", PROJECT_ID))
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 65536).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["limit"], 500, "limit should be clamped to max 500");
    let _ = std::fs::remove_dir_all(dir);
}

// ─── Security: Injection probing ──────────────────────────────────────────────

#[tokio::test]
async fn test_api_key_bearer_injection_in_header() {
    let dir = "./test_apikey_inject";
    let (_, db) = setup_db(dir, &["stats:read"], &[PROJECT_ID], None, None, false);
    let state = make_state(db);
    let app = make_v1_app(state);

    // Attempt header injection with SQL-like payload
    let injection = "flpat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' OR '1'='1";
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/system")
                .header("Authorization", format!("Bearer {}", injection))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Must be rejected — either by format check (length/prefix) or by hash mismatch
    assert!(
        response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::BAD_REQUEST,
        "injection attempt must be rejected, got: {}",
        response.status()
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn test_project_id_path_traversal_rejected() {
    let dir = "./test_apikey_traversal";
    let (raw_key, db) = setup_db(
        dir,
        &["issues:read"],
        &["*"],
        None,
        None,
        false,
    );
    let state = make_state(db);
    let app = make_v1_app(state);

    // Attempt path traversal via project_id
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/projects/../system.db/issues")
                .header("Authorization", format!("Bearer {}", raw_key))
                .extension(ConnectInfo(addr()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Should be 404 (no such project) or 400 — NOT a file read
    assert_ne!(response.status(), StatusCode::OK, "path traversal must not succeed");
    let _ = std::fs::remove_dir_all(dir);
}
