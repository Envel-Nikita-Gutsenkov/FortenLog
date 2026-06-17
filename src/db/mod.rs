use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use dashmap::DashMap;
use moka::future::Cache;
use std::time::Duration;

pub mod system;
pub mod projects;
pub mod cache;

const DEFAULT_CACHE_MB: u64 = 256;

pub struct DbManager {
    pub(crate) base_path: PathBuf,
    pub(crate) system_pool: Pool<SqliteConnectionManager>,
    pub(crate) project_pools: Arc<DashMap<String, Pool<SqliteConnectionManager>>>,
    /// Global stats/dashboard cache (small, shared)
    pub cache: Cache<String, serde_json::Value>,
    /// Per-project caches — each project gets its own configurable Moka cache.
    /// Key: project_id, Value: (Cache, size_mb)
    pub(crate) project_caches: Arc<DashMap<String, Cache<String, serde_json::Value>>>,
}

impl DbManager {
    pub fn new<P: AsRef<Path>>(base_path: P) -> anyhow::Result<Self> {
        let base_path = base_path.as_ref().to_path_buf();
        std::fs::create_dir_all(&base_path)?;
        std::fs::create_dir_all(base_path.join("projects"))?;

        // System DB for projects, users, global settings
        let system_manager = SqliteConnectionManager::file(base_path.join("system.db"));
        let system_pool = Pool::new(system_manager)?;
        
        // Apply system DB optimizations
        {
            let conn = system_pool.get()?;
            conn.execute_batch("PRAGMA journal_mode=WAL;")?;
            conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
            conn.execute_batch("PRAGMA cache_size=-32768;")?;       // 32MB page cache
            conn.execute_batch("PRAGMA mmap_size=67108864;")?;       // 64MB memory-mapped IO
            conn.execute_batch("PRAGMA temp_store=MEMORY;")?;        // temp tables in RAM, not disk
            conn.execute_batch("PRAGMA threads=4;")?;                 // parallel query processing
            // Auto-checkpoint: SQLite triggers PASSIVE checkpoint every 1000 pages (~8MB WAL).
            // This is per-connection hint, not a global setting.
            conn.execute_batch("PRAGMA wal_autocheckpoint=1000;")?;  // ~8MB WAL before auto-sync
            conn.execute_batch("PRAGMA busy_timeout=5000;")?;        // 5s wait on lock contention
        }
        
        Self::init_system_db(&system_pool)?;

        let cache = Cache::builder()
            .max_capacity(256 * 1024 * 1024) // 256MB
            .time_to_live(Duration::from_secs(600))
            .build();

        Ok(Self {
            base_path,
            system_pool,
            project_pools: Arc::new(DashMap::new()),
            cache,
            project_caches: Arc::new(DashMap::new()),
        })
    }
}
