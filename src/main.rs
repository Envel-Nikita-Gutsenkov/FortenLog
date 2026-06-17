extern crate rand;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use crate::db::DbManager as FortenDb;
use crate::handlers::ingest::{AppState, ingestion_worker, sentry_envelope};
use crate::handlers::dashboard::get_dashboard_stats;
use crate::handlers::settings::{list_projects, create_project, get_storage_stats, create_backup};
use crate::handlers::settings_audit::get_audit_logs;
use crate::handlers::issues::{resolve_issue, get_issue_events, get_event_detail, get_all_events};
use crate::handlers::uptime::{uptime_worker, list_monitors, create_monitor, delete_monitor, get_monitor_logs};
use crate::ui::Asset;

use tokio::sync::mpsc;
use axum::{
    routing::{get, post, delete, put},
    Router,
};
use tower_http::trace::TraceLayer;

pub mod db;
pub mod models;
pub mod middleware;
pub mod ui;

pub mod handlers {
    pub mod auth;
    pub mod ingest;
    pub mod dashboard;
    pub mod settings;
    pub mod settings_audit;
    pub mod issues;
    pub mod uptime;
    pub mod seed;
    pub mod explorer;
    pub mod maintenance;
    pub mod users;
    pub mod export;
    pub mod api_keys;
}
pub mod security;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db_manager = Arc::new(FortenDb::new("./data")?);
    // 50k channel buffer: handles bursts of 1000 traces/sec for ~50 seconds without backpressure
    let channel_cap: usize = std::env::var("INGEST_CHANNEL_SIZE")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(50_000);
    let (ingest_tx, ingest_rx) = mpsc::channel(channel_cap);
    let (session_tx, session_rx) = mpsc::channel(10_000);
    let worker_db = Arc::clone(&db_manager);
    let session_db = Arc::clone(&db_manager);

    // Bootstrap Admin securely if not exists
    if let Ok(conn) = db_manager.get_system_conn() {
        let admin_user = std::env::var("FORTENLOG_ADMIN_USER").unwrap_or_else(|_| "admin".into());
        let admin_exists: bool = conn.query_row(
            "SELECT 1 FROM users WHERE username = ?1 AND is_admin = 1",
            [&admin_user],
            |_| Ok(true)
        ).unwrap_or(false);

        if !admin_exists {
            use argon2::{password_hash::{rand_core::OsRng, PasswordHasher, SaltString}, Argon2};
            
            let admin_pass = std::env::var("FORTENLOG_ADMIN_PASS").unwrap_or_else(|_| "fortenlog2026".into());

            let salt = SaltString::generate(&mut OsRng);
            if let Ok(password_hash) = Argon2::default().hash_password(admin_pass.as_bytes(), &salt) {
                let hash_str = password_hash.to_string();
                let is_default = admin_pass == "fortenlog2026";
                let _ = conn.execute(
                    "INSERT INTO users (username, password_hash, is_admin, password_change_required) VALUES (?1, ?2, 1, ?3)",
                    rusqlite::params![admin_user.clone(), hash_str, if is_default { 1 } else { 0 }]
                );
                println!("[SECURITY] Default admin account created ({} / {}). PLEASE CHANGE IMMEDIATELY.", admin_user, admin_pass);
            } else {
                eprintln!("[ERROR] Failed to hash admin password during bootstrap.");
            }
        } else {
            println!("[SECURITY] Admin account '{}' already exists in the database. Bootstrapping skipped.", admin_user);
        }

        // Seed default Analytics dashboard for admin if none exists
        let dash_exists: bool = conn.query_row(
            "SELECT 1 FROM dashboards WHERE id = 'demo-analytics-default' OR name = 'Demo App Analytics'",
            [],
            |_| Ok(true)
        ).unwrap_or(false);

        if !dash_exists {
            let default_config = serde_json::json!([
                {
                    "title": "Selected Version Tracker",
                    "projectId": "default",
                    "table": "events",
                    "metric": "count",
                    "dimension": "title",
                    "filters": [
                        {"column": "event_type", "op": "eq", "value": "posthog"}
                    ],
                    "chartType": "bar",
                    "widthSpan": "2",
                    "heightSpan": "medium",
                    "colorPalette": "neon_grape",
                    "showLegend": true,
                    "showGridlines": true
                },
                {
                    "title": "Custom Telemetry Report",
                    "projectId": "default",
                    "table": "events",
                    "metric": "count",
                    "dimension": "os",
                    "filters": [],
                    "chartType": "bar",
                    "widthSpan": "2",
                    "heightSpan": "medium",
                    "colorPalette": "cyberpunk",
                    "showLegend": true,
                    "showGridlines": true
                }
            ]);
            if let Ok(default_config_str) = serde_json::to_string(&default_config) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO dashboards (id, username, name, config) VALUES (?1, ?2, ?3, ?4)",
                    ["demo-analytics-default", "admin", "Demo App Analytics", &default_config_str]
                );
                println!("[BOOTSTRAP] Seeded default Demo App Analytics dashboard.");
            }
        }
    }
    
    // Worker will be spawned after state initialization

    let uptime_db = Arc::clone(&db_manager);
    tokio::spawn(async move {
        uptime_worker(uptime_db).await;
    });

    tokio::spawn(async move {
        crate::handlers::ingest::session_worker(session_rx, session_db).await;
    });


    /*
    let rp_id = std::env::var("RP_ID").unwrap_or_else(|_| "localhost".into());
    let rp_origin_url = std::env::var("RP_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into());
    let rp_origin = url::Url::parse(&rp_origin_url).expect("Invalid RP_ORIGIN");

    let webauthn = webauthn_rs::WebauthnBuilder::new(&rp_id, &rp_origin)
        .expect("Invalid Webauthn configuration")
        .build()
        .expect("Failed to build Webauthn");
    */

    let state = Arc::new(AppState {
        ingest_tx,
        session_tx,
        // Bounded Moka sync cache: deduplicates repeated fingerprints per user.
        // 100k entries max + 1h TTL prevent unbounded memory growth under flood.
        stack_cache: moka::sync::Cache::builder()
            .max_capacity(100_000)
            .time_to_live(std::time::Duration::from_secs(3600))
            .build(),
        ip_rate_limit: moka::future::Cache::builder()
            .max_capacity(10000)
            .time_to_idle(std::time::Duration::from_secs(600))
            .time_to_live(std::time::Duration::from_secs(3600))
            .build(),
        ingest_rate_limit_10m: moka::future::Cache::builder()
            .max_capacity(100000)
            .time_to_live(std::time::Duration::from_secs(600))
            .build(),
        ingest_rate_limit_day: moka::future::Cache::builder()
            .max_capacity(100000)
            .time_to_live(std::time::Duration::from_secs(86400))
            .build(),
        issue_rpm_cache: moka::future::Cache::builder()
            .max_capacity(50000)
            .time_to_live(std::time::Duration::from_secs(60))
            .build(),
        // 120 req/min per API key prefix; entries expire after 60s (sliding window)
        api_key_rate_limit: moka::future::Cache::builder()
            .max_capacity(20000)
            .time_to_live(std::time::Duration::from_secs(60))
            .build(),
        db_manager,
        auth_config: crate::middleware::auth::AuthConfig { allowed_ips: vec!["*".into()], stealth_mode: false },
        metrics: Arc::new(crate::handlers::ingest::IngestionPerformanceMetrics::new()),
    });

    let rpm_cache = state.issue_rpm_cache.clone();
    let metrics = state.metrics.clone();
    tokio::spawn(async move {
        // batch_size: flush after N events (default 500, handles 1000/sec with 0.5s latency)
        // batch_interval: flush every N seconds even if batch not full (default 1s)
        let batch_size: usize = std::env::var("INGEST_BATCH_SIZE")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(500);
        let batch_interval: u64 = std::env::var("INGEST_BATCH_INTERVAL_SECS")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(1);
        ingestion_worker(ingest_rx, worker_db, batch_size, batch_interval, rpm_cache, metrics).await;
    });

    // Start background maintenance worker
    tokio::spawn(crate::handlers::maintenance::storage_policy_worker(state.db_manager.clone()));

    let app = Router::new()
        .route("/api/:project_id/envelope/", post(sentry_envelope).layer(axum::extract::DefaultBodyLimit::max(512 * 1024)))
        .route("/capture", post(crate::handlers::ingest::posthog_capture).layer(axum::extract::DefaultBodyLimit::max(512 * 1024)))
        .route("/capture/", post(crate::handlers::ingest::posthog_capture).layer(axum::extract::DefaultBodyLimit::max(512 * 1024)))
        .route("/batch", post(crate::handlers::ingest::posthog_capture).layer(axum::extract::DefaultBodyLimit::max(512 * 1024)))
        .route("/batch/", post(crate::handlers::ingest::posthog_capture).layer(axum::extract::DefaultBodyLimit::max(512 * 1024)))
        .route("/api/dashboard/stats", get(get_dashboard_stats))
        .route("/api/dashboard/query", post(crate::handlers::dashboard::execute_custom_query))
        .route("/api/dashboards", get(crate::handlers::dashboard::list_dashboards).post(crate::handlers::dashboard::save_dashboard))
        .route("/api/dashboards/:id", delete(crate::handlers::dashboard::delete_dashboard))
        .route("/api/projects/:project_id/issues/:id/resolve", post(resolve_issue))
        .route("/api/projects/:project_id/issues/:id", get(crate::handlers::issues::get_issue_detail).put(crate::handlers::issues::update_issue).delete(crate::handlers::issues::delete_issue))
        .route("/api/projects/:project_id/issues/:id/users", get(crate::handlers::issues::get_issue_users))
        .route("/api/projects/:project_id/issues/:id/events", get(get_issue_events))
        .route("/api/projects/:project_id/issues/:id/events/:event_id", get(get_event_detail))
        .route("/api/projects/:project_id/issues/:id/export", get(crate::handlers::issues::export_issue_data))
        .route("/api/issues/clear/:id", post(crate::handlers::issues::clear_project_data))
        .route("/api/explorer/query", get(crate::handlers::explorer::query_events))
        .route("/api/projects/:project_id/events/:event_id", delete(crate::handlers::explorer::delete_event))
        .route("/api/explorer/export", get(crate::handlers::explorer::export_explorer))
        .route("/api/system/maintenance/compress", post(crate::handlers::maintenance::run_compression))
        .route("/api/settings/projects", get(list_projects).post(create_project))
        .route("/api/settings/projects/:id", delete(crate::handlers::settings::delete_project).put(crate::handlers::settings::update_project))
        .route("/api/settings/audit", get(get_audit_logs))
        .route("/api/settings/audit/clear", post(crate::handlers::settings_audit::clear_audit_logs))
        .route("/api/settings/storage", get(get_storage_stats))
        .route("/api/settings/storage/:id/backup", post(create_backup))
        .route("/api/settings/storage/:id/vacuum", post(crate::handlers::settings::vacuum_project))
        
        // System Alias Routes (for Frontend compatibility)
        .route("/api/system/storage", get(get_storage_stats))
        .route("/api/system/backup", post(crate::handlers::settings::create_system_backup))
        .route("/api/system/vacuum", post(crate::handlers::settings::vacuum_all_databases))
        .route("/api/system/backups", get(crate::handlers::settings::list_system_backups))
        .route("/api/system/backups/:filename", delete(crate::handlers::settings::delete_system_backup))
        .route("/api/system/backups/:filename/restore", post(crate::handlers::settings::restore_system_backup))
        
        .route("/api/uptime", get(list_monitors).post(create_monitor))
        .route("/api/uptime/:id", delete(delete_monitor))
        .route("/api/uptime/:id/logs", get(get_monitor_logs))
        .route("/api/users", get(crate::handlers::users::list_users).post(crate::handlers::users::create_user))
        .route("/api/users/:username", delete(crate::handlers::users::delete_user))
        .route("/api/users/:username/reset-password", post(crate::handlers::users::admin_reset_password))
        .route("/api/users/:username/role", put(crate::handlers::users::update_user_role))
        .route("/api/users/:username/projects", put(crate::handlers::users::update_user_projects))
        .route("/api/system/me", get(crate::handlers::users::get_current_user))
        .route("/api/system/events", get(get_all_events))
        .route("/api/system/settings", get(crate::handlers::settings::get_system_settings))
        .route("/api/system/settings", post(crate::handlers::settings::update_system_settings))
        .route("/api/system/performance", get(crate::handlers::settings::get_system_performance))
        .route("/api/system/errors/clear", post(crate::handlers::settings::clear_internal_errors))
        .route("/api/system/export/csv", get(crate::handlers::export::export_csv))
        .route("/api/system/2fa/setup", post(crate::handlers::auth::setup_2fa))
        .route("/api/system/2fa/verify", post(crate::handlers::auth::verify_2fa))
        .route("/api/system/webauthn/register/start", post(crate::handlers::auth::webauthn_register_start))
        .route("/api/system/webauthn/register/finish", post(crate::handlers::auth::webauthn_register_finish))
        .route("/api/system/webauthn/login/start", post(crate::handlers::auth::webauthn_login_start))
        .route("/api/system/webauthn/login/finish", post(crate::handlers::auth::webauthn_login_finish))
        .route("/api/system/sessions", get(crate::handlers::auth::list_sessions))
        .route("/api/system/sessions/:id", delete(crate::handlers::auth::revoke_session))
        .route("/api/system/security/history", get(crate::handlers::auth::get_login_history))
        .route("/api/system/security/password", post(crate::handlers::users::update_password))
        .route("/api/system/login", post(crate::handlers::auth::login))
        .route("/api/system/logout", post(crate::handlers::auth::logout))
        .route("/api/system/health", get(|| async { axum::Json(serde_json::json!({ "status": "ok" })) }))
        // API key management (session-authenticated, admin only)
        .route("/api/system/api-keys",
            get(crate::handlers::api_keys::management::list_api_keys)
            .post(crate::handlers::api_keys::management::create_api_key))
        .route("/api/system/api-keys/:id",
            delete(crate::handlers::api_keys::management::revoke_api_key)
            .put(crate::handlers::api_keys::management::update_api_key))
        .layer(axum::middleware::from_fn_with_state(state.clone(), crate::middleware::auth::auth_middleware))
        .layer(axum::extract::DefaultBodyLimit::max(4 * 1024 * 1024));

    // Public REST API v1 — authenticated via API key Bearer token
    let v1_router = Router::new()
        .route("/v1/system", get(crate::handlers::api_keys::v1::v1_system_info))
        .route("/v1/projects", get(crate::handlers::api_keys::v1::v1_list_projects))
        .route("/v1/projects/:project_id/issues",
            get(crate::handlers::api_keys::v1::v1_list_issues))
        .route("/v1/projects/:project_id/issues/:issue_id",
            get(crate::handlers::api_keys::v1::v1_get_issue))
        .route("/v1/projects/:project_id/issues/:issue_id/events",
            get(crate::handlers::api_keys::v1::v1_get_issue_events))
        .route("/v1/projects/:project_id/issues/:issue_id/events/:event_id",
            get(crate::handlers::api_keys::v1::v1_get_event_detail))
        .route("/v1/projects/:project_id/events",
            get(crate::handlers::api_keys::v1::v1_list_events))
        .route("/v1/projects/:project_id/stats",
            get(crate::handlers::api_keys::v1::v1_get_stats))
        .route("/v1/projects/:project_id/analytics",
            get(crate::handlers::api_keys::v1::v1_get_analytics))
        .route("/v1/projects/:project_id/sessions",
            get(crate::handlers::api_keys::v1::v1_get_sessions))
        .route("/v1/projects/:project_id/uptime",
            get(crate::handlers::api_keys::v1::v1_get_uptime))
        .route("/v1/projects/:project_id/uptime/:monitor_id/logs",
            get(crate::handlers::api_keys::v1::v1_get_uptime_logs))
        .layer(axum::middleware::from_fn_with_state(state.clone(), crate::middleware::api_key::api_key_auth_middleware))
        .layer(axum::middleware::from_fn(crate::middleware::auth::security_headers))
        .with_state(state.clone());

    let app = app.merge(v1_router);

    let app = app.route("/", get(|| async {
            let index = Asset::get("index.html").expect("index.html not found");
            axum::response::Response::builder()
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-cache, no-store, must-revalidate")
                .body(axum::body::Body::from(index.data))
                .unwrap()
        }))
        .fallback(get(|req: axum::http::Request<axum::body::Body>| async move {
            let full_path = req.uri().path();
            let path = full_path.trim_start_matches('/');
            
            tracing::debug!("FALLBACK_REQUEST: raw='{}', resolved='{}'", full_path, path);

            if path.is_empty() || path == "index.html" {
                let index = Asset::get("index.html").expect("index.html not found");
                return axum::response::Response::builder()
                    .header("content-type", "text/html; charset=utf-8")
                    .header("cache-control", "no-cache, no-store, must-revalidate")
                    .body(axum::body::Body::from(index.data))
                    .unwrap();
            }

            // Try to find the exact asset
            if let Some(asset) = Asset::get(path) {
                let content_type = match path.split('.').last() {
                    Some("css") => "text/css; charset=utf-8",
                    Some("js") => "application/javascript; charset=utf-8",
                    Some("png") => "image/png",
                    Some("svg") => "image/svg+xml",
                    Some("woff2") => "font/woff2",
                    _ => "application/octet-stream",
                };
                tracing::debug!("SERVING_ASSET: path='{}', type='{}', size={}", path, content_type, asset.data.len());
                let mut builder = axum::response::Response::builder()
                    .header("content-type", content_type);
                
                // Disable caching for HTML, CSS, and JS to prevent stale UI bundles on client updates
                if path.ends_with(".js") || path.ends_with(".css") || path.ends_with(".html") {
                    builder = builder.header("cache-control", "no-cache, no-store, must-revalidate");
                } else {
                    // Cache assets like images/fonts for up to 1 day
                    builder = builder.header("cache-control", "public, max-age=86400");
                }

                return builder
                    .body(axum::body::Body::from(asset.data))
                    .unwrap();
            }

            // For SPA: if not a file (no extension) or not found, return index.html
            if path.contains('.') {
                tracing::warn!("ASSET_NOT_FOUND: path='{}'", path);
                return axum::response::Response::builder()
                    .status(axum::http::StatusCode::NOT_FOUND)
                    .body(axum::body::Body::empty())
                    .unwrap();
            }
            
            tracing::debug!("SPA_FALLBACK: path='{}' -> index.html", path);
            let index = Asset::get("index.html").expect("index.html not found");
            axum::response::Response::builder()
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-cache, no-store, must-revalidate")
                .body(axum::body::Body::from(index.data))
                .unwrap()
        }))
        .layer(axum::middleware::from_fn(crate::middleware::auth::security_headers))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &axum::http::Request<_>| {
                    let path = request.uri().path();
                    if path == "/api/system/performance" {
                        tracing::Span::none()
                    } else {
                        // Sanitize URI: strip query string from logs to avoid leaking api_key/tokens
                        tracing::info_span!(
                            "request",
                            method = %request.method(),
                            path = %path,
                            version = ?request.version(),
                        )
                    }
                })
                .on_request(|request: &axum::http::Request<_>, span: &tracing::Span| {
                    if !span.is_none() {
                        tracing::debug!(
                            parent: span,
                            "started processing request: {} {}",
                            request.method(),
                            request.uri()
                        );
                    }
                })
                .on_response(|response: &axum::http::Response<_>, latency: std::time::Duration, span: &tracing::Span| {
                    if !span.is_none() {
                        tracing::debug!(
                            parent: span,
                            latency = ?latency,
                            status = %response.status().as_u16(),
                            "finished processing request"
                        );
                    }
                })
        )
        .with_state(state.clone());

    // Seed endpoint only available in debug builds (never shipped to production)
    #[cfg(debug_assertions)]
    let app = app.route("/api/system/seed", post(crate::handlers::seed::seed_test_data)
        .layer(axum::middleware::from_fn_with_state(state.clone(), crate::middleware::auth::auth_middleware)))
        .with_state(state);
    #[cfg(not(debug_assertions))]
    let app = app.with_state(state);

    let addr = "0.0.0.0:3000";
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("FORTENLOG_LISTENING_ON: {}", addr);
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;

    Ok(())
}
