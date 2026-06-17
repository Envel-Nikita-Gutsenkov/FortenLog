use super::DbManager;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

impl DbManager {
    pub fn get_project_pool(&self, project_id: &str) -> anyhow::Result<Pool<SqliteConnectionManager>> {
        if let Some(pool) = self.project_pools.get(project_id) {
            return Ok(pool.clone());
        }

        let db_path = self.base_path.join("projects").join(format!("{}.db", project_id));
        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::new(manager)?;
        
        // Initialize project-specific tables with all performance optimizations
        let conn = pool.get()?;
        // WAL mode: allows concurrent reads during writes — critical for telemetry under load
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        // Tune for throughput: fsync only on WAL checkpoints (safe with WAL)
        conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
        // 64MB page cache per connection
        conn.execute_batch("PRAGMA cache_size=-65536;")?;
        // Memory-mapped I/O: 256MB — the OS handles caching, massively faster reads
        conn.execute_batch("PRAGMA mmap_size=268435456;")?;
        // Larger pages = better compression ratio for blob data
        conn.execute_batch("PRAGMA page_size=8192;")?;
        // Temp tables (sorts, GROUP BY) go to RAM instead of temp files on disk
        conn.execute_batch("PRAGMA temp_store=MEMORY;")?;
        // SQLite can use multiple OS threads for read queries
        conn.execute_batch("PRAGMA threads=4;")?;
        // Auto-checkpoint: after 2000 pages (~16MB WAL), SQLite syncs to main file automatically.
        // This is the primary sync mechanism — no need for external timer on low traffic.
        conn.execute_batch("PRAGMA wal_autocheckpoint=2000;")?;
        // Wait up to 5 seconds if another writer holds the lock (avoids SQLITE_BUSY errors)
        conn.execute_batch("PRAGMA busy_timeout=5000;")?;
        conn.execute_batch(include_str!("sqlite_project.sql"))?;

        // Migrations: dynamically add newer columns to older databases before creating indexes
        let _ = conn.execute("ALTER TABLE events ADD COLUMN hwid TEXT", []);
        let _ = conn.execute("ALTER TABLE events ADD COLUMN event_type TEXT", []);
        let _ = conn.execute("ALTER TABLE events ADD COLUMN environment TEXT", []);
        let _ = conn.execute("ALTER TABLE events ADD COLUMN stack_hash TEXT", []);
        let _ = conn.execute("ALTER TABLE events ADD COLUMN title TEXT", []);
        let _ = conn.execute("ALTER TABLE payloads ADD COLUMN size_original INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE payloads ADD COLUMN size_compressed INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE issues ADD COLUMN is_suppressed INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE issues ADD COLUMN resolved_in_version TEXT", []);


        // High-performance cover indexes for custom dashboard analytical queries
        conn.execute_batch("
            CREATE INDEX IF NOT EXISTS idx_events_os ON events(os) WHERE os IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_events_browser ON events(browser) WHERE browser IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_events_region ON events(region) WHERE region IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_events_release ON events(release_version) WHERE release_version IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_events_environment ON events(environment) WHERE environment IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type) WHERE event_type IS NOT NULL;
        ")?;

        // Auto-heal historical data: copy issue titles to events table before separating Sentry and PostHog tables
        let _ = conn.execute("UPDATE events SET title = (SELECT title FROM issues WHERE issues.id = events.issue_id) WHERE title IS NULL AND issue_id IS NOT NULL", []);
        let _ = conn.execute("UPDATE events SET issue_id = NULL, stack_hash = NULL WHERE event_type = 'posthog'", []);
        let _ = conn.execute("DELETE FROM issues WHERE id NOT IN (SELECT DISTINCT issue_id FROM events WHERE issue_id IS NOT NULL)", []);

        // Recover PostHog titles from compressed raw payloads if still NULL (e.g. if they were already untangled in a previous session)
        if let Ok(mut stmt) = conn.prepare("SELECT e.id, p.data FROM events e INNER JOIN payloads p ON e.payload_hash = p.hash WHERE e.event_type = 'posthog' AND e.title IS NULL") {
            struct RawEventPayload {
                id: String,
                data: Vec<u8>,
            }
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok(RawEventPayload {
                    id: row.get(0)?,
                    data: row.get(1)?,
                })
            }) {
                let mut updates = Vec::new();
                for r in rows.filter_map(|x| x.ok()) {
                    if let Ok(decompressed) = zstd::stream::decode_all(r.data.as_slice()) {
                        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&decompressed) {
                            if let Some(event_name) = val.get("event").and_then(|v| v.as_str()) {
                                updates.push((r.id, event_name.to_string()));
                            }
                        }
                    }
                }
                for (id, name) in updates {
                    let _ = conn.execute("UPDATE events SET title = ?1 WHERE id = ?2", rusqlite::params![name, id]);
                }
            }
        }

        self.project_pools.insert(project_id.to_string(), pool.clone());
        Ok(pool)
    }

    pub fn remove_project_resources(&self, project_id: &str) {
        self.project_pools.remove(project_id);
        self.project_caches.remove(project_id);
    }
}
