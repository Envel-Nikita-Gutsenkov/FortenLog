use super::DbManager;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use sha2::{Digest, Sha256};

impl DbManager {
    pub(crate) fn init_system_db(pool: &Pool<SqliteConnectionManager>) -> anyhow::Result<()> {
        let conn = pool.get()?;
        conn.execute_batch(include_str!("sqlite_system.sql"))?;

        // System DB Migrations
        let _ = conn.execute("ALTER TABLE projects ADD COLUMN github_repo TEXT", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN allowed_projects TEXT", []);
        let _ = conn.execute("ALTER TABLE dashboards ADD COLUMN project_id TEXT", []);
        let _ = conn.execute("ALTER TABLE uptime_monitors ADD COLUMN project_id TEXT", []);
        let _ = conn.execute("ALTER TABLE users ADD COLUMN password_change_required INTEGER DEFAULT 0", []);
        // api_keys migration: table created by DDL above, but ensure it exists for older DBs
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS api_keys (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                key_hash     TEXT NOT NULL UNIQUE,
                key_prefix   TEXT NOT NULL,
                owner        TEXT NOT NULL,
                project_ids  TEXT NOT NULL DEFAULT '[]',
                scopes       TEXT NOT NULL DEFAULT '[]',
                allowed_ips  TEXT,
                expires_at   TEXT,
                last_used_at TEXT,
                created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
                is_revoked   INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
            CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner);"
        );

        Ok(())
    }


    pub fn log_internal_error(&self, component: &str, error_message: &str, context: Option<&str>) {
        let enabled = if let Ok(conn) = self.get_system_conn() {
            conn.query_row(
                "SELECT value FROM system_settings WHERE key = 'enable_internal_error_logging'",
                [],
                |row| row.get::<_, String>(0)
            ).unwrap_or_else(|_| "true".to_string())
        } else {
            "true".to_string()
        } == "true";

        if !enabled {
            return;
        }

        if let Ok(conn) = self.get_system_conn() {
            let _ = conn.execute(
                "INSERT INTO internal_errors (component, error_message, context) VALUES (?1, ?2, ?3)",
                rusqlite::params![component, error_message, context.unwrap_or("")],
            );
        }

        // Also log the internal error directly into "default-project" (FortenLog Core) issues/events
        if let Ok(pool) = self.get_project_pool("default-project") {
            if let Ok(mut conn) = pool.get() {
                if let Ok(tx) = conn.transaction() {
                    let now_str = chrono::Utc::now().to_rfc3339();
                    
                    // Generate fingerprint based on component and error message
                    let mut hasher = Sha256::new();
                    hasher.update(component.as_bytes());
                    hasher.update(error_message.as_bytes());
                    let error_hash = format!("{:x}", hasher.finalize());
                    let fingerprint = format!("internal-{}-{}", component.replace(' ', "_"), &error_hash[..16]);
                    
                    // Prepare stack trace hash
                    let mut hasher_st = Sha256::new();
                    hasher_st.update(fingerprint.as_bytes());
                    let stack_hash = format!("{:x}", hasher_st.finalize());
                    
                    // Prepare payload JSON
                    let payload_json = serde_json::json!({
                        "exception": {
                            "values": [{
                                "type": format!("InternalError[{}]", component),
                                "value": error_message,
                                "stacktrace": {
                                    "frames": [
                                        {"filename": component, "function": "log_internal_error", "lineno": 0, "colno": 0, "in_app": true}
                                    ]
                                }
                            }]
                        },
                        "extra": {
                            "context": context.unwrap_or("")
                        }
                    });
                    
                    let payload_bytes = serde_json::to_vec(&payload_json).unwrap_or_default();
                    let payload_len = payload_bytes.len() as i64;
                    
                    // Compress with zstd
                    let compressed_payload = zstd::stream::encode_all(&payload_bytes[..], 0).unwrap_or_else(|_| payload_bytes.clone());
                    let compressed_len = compressed_payload.len() as i64;
                    
                    let mut hasher_pl = Sha256::new();
                    hasher_pl.update(&compressed_payload);
                    let payload_hash = format!("{:x}", hasher_pl.finalize());
                    
                    // Insert payload
                    let _ = tx.execute(
                        "INSERT OR IGNORE INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![payload_hash, compressed_payload, payload_len, compressed_len]
                    );
                    
                    // Insert stack trace
                    let _ = tx.execute(
                        "INSERT OR IGNORE INTO stack_traces (hash, normalized) VALUES (?1, ?2)",
                        rusqlite::params![stack_hash, fingerprint]
                    );
                    
                    // Insert or update issue
                    let _ = tx.execute(
                        "INSERT INTO issues (id, title, culprit, status, count, users_affected, last_seen, is_suppressed)
                         VALUES (?1, ?2, ?3, 'unhandled', 1, 1, ?4, 0)
                         ON CONFLICT(id) DO UPDATE SET
                             count = count + 1,
                             last_seen = ?4",
                        rusqlite::params![
                            fingerprint,
                            error_message,
                            component,
                            now_str
                        ]
                    );
                    
                    // Insert event
                    let event_id = uuid::Uuid::new_v4().to_string();
                    let _ = tx.execute(
                        "INSERT INTO events (id, issue_id, timestamp, event_type, hwid, ip_address, os, browser, region, release_version, environment, stack_hash, payload_hash, title)
                         VALUES (?1, ?2, ?3, 'sentry', 'system', '127.0.0.1', 'Server', 'Rust Daemon', 'RU', '1.0.0', 'production', ?4, ?5, ?6)",
                        rusqlite::params![
                            event_id,
                            fingerprint,
                            now_str,
                            stack_hash,
                            payload_hash,
                            error_message
                        ]
                    );
                    
                    if tx.commit().is_ok() {
                        // Invalidate caches in background
                        let cache_opt = self.project_caches.get("default-project").map(|c| c.clone());
                        let global_cache = self.cache.clone();
                        tokio::spawn(async move {
                            if let Some(cache) = cache_opt {
                                cache.invalidate("issues_summary").await;
                                cache.invalidate("event_counts").await;
                                cache.invalidate("dashboard:default-project").await;
                            }
                            global_cache.invalidate("dashboard:all").await;
                        });
                    }
                }
            }
        }
    }

    pub fn get_system_conn(&self) -> anyhow::Result<r2d2::PooledConnection<SqliteConnectionManager>> {
        Ok(self.system_pool.get()?)
    }

    // Support for the stats dashboard (Legacy/Helper)
    pub fn get_stats_pool(&self) -> Pool<SqliteConnectionManager> {
        // For compatibility during refactor
        self.system_pool.clone()
    }
}

