use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use tokio::sync::mpsc;
use crate::models::TelemetryEvent;
use crate::db::DbManager;
use moka::future::Cache;
use moka::sync::Cache as SyncCache;

pub struct IngestionPerformanceMetrics {
    pub total_received: AtomicU64,
    pub total_processed: AtomicU64,
    pub total_dropped: AtomicU64,
    pub total_rate_limited: AtomicU64,
    pub last_latency_micros: AtomicU64,
    pub db_flushes_success: AtomicU64,
    pub db_flushes_failed: AtomicU64,
}

impl IngestionPerformanceMetrics {
    pub fn new() -> Self {
        Self {
            total_received: AtomicU64::new(0),
            total_processed: AtomicU64::new(0),
            total_dropped: AtomicU64::new(0),
            total_rate_limited: AtomicU64::new(0),
            last_latency_micros: AtomicU64::new(0),
            db_flushes_success: AtomicU64::new(0),
            db_flushes_failed: AtomicU64::new(0),
        }
    }
}

pub struct AppState {
    pub ingest_tx: mpsc::Sender<TelemetryEvent>,
    pub session_tx: mpsc::Sender<crate::models::SessionEvent>,
    /// Bounded dedup cache: prevents a single user from flooding the same fingerprint.
    /// Moka sync cache with TTL ensures memory is always bounded (100k entries, 1h TTL).
    pub stack_cache: SyncCache<String, u32>,
    pub ip_rate_limit: Cache<String, (u32, std::time::Instant)>,
    pub ingest_rate_limit_10m: Cache<String, (u32, u64)>,
    pub ingest_rate_limit_day: Cache<String, (u32, u64)>,
    pub issue_rpm_cache: Cache<String, u32>,
    /// API-key rate limiter: 120 requests/min per key prefix (sliding window via 60s TTL).
    pub api_key_rate_limit: Cache<String, u32>,
    pub db_manager: Arc<DbManager>,
    pub auth_config: crate::middleware::auth::AuthConfig,
    pub metrics: Arc<IngestionPerformanceMetrics>,
}


pub mod envelope;
pub mod capture;
pub mod worker;
pub mod utils;

pub use envelope::*;
pub use capture::*;
pub use worker::*;
pub use utils::*;
