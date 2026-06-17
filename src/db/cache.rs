use super::{DbManager, DEFAULT_CACHE_MB};
use moka::future::Cache;
use std::time::Duration;

impl DbManager {
    /// Returns the per-project Moka cache, creating it on first access with the configured size.
    pub fn get_project_cache(&self, project_id: &str) -> Cache<String, serde_json::Value> {
        if let Some(c) = self.project_caches.get(project_id) {
            return c.clone();
        }
        // Read project-specific cache size from DB (falls back to DEFAULT_CACHE_MB)
        let size_mb = self.get_system_conn()
            .ok()
            .and_then(|conn| conn.query_row(
                "SELECT cache_size_mb FROM projects WHERE id = ?1",
                [project_id],
                |row| row.get::<_, u64>(0)
            ).ok())
            .unwrap_or(DEFAULT_CACHE_MB);

        let cache = Cache::builder()
            .max_capacity(size_mb * 1024 * 1024)
            .weigher(|_key: &String, value: &serde_json::Value| -> u32 {
                serde_json::to_string(value).unwrap_or_default().len() as u32
            })
            .time_to_live(Duration::from_secs(600))
            .time_to_idle(Duration::from_secs(120))
            .build();
        self.project_caches.insert(project_id.to_string(), cache.clone());
        cache
    }

    /// Invalidate a specific key in the per-project cache (call after writes).
    pub async fn cache_invalidate(&self, project_id: &str, key: &str) {
        if let Some(c) = self.project_caches.get(project_id) {
            c.invalidate(key).await;
        }
    }

    /// Resize a project's cache (e.g. when admin updates cache_size_mb setting).
    pub fn resize_project_cache(&self, project_id: &str, size_mb: u64) {
        let cache = Cache::builder()
            .max_capacity(size_mb * 1024 * 1024)
            .weigher(|_key: &String, value: &serde_json::Value| -> u32 {
                serde_json::to_string(value).unwrap_or_default().len() as u32
            })
            .time_to_live(Duration::from_secs(600))
            .time_to_idle(Duration::from_secs(120))
            .build();
        self.project_caches.insert(project_id.to_string(), cache);
    }

    pub async fn invalidate_dashboard_cache(&self, project_id: &str) {
        let key = format!("dashboard:{}", project_id);
        if let Some(cache) = self.project_caches.get(project_id) {
            cache.invalidate(&key).await;
        }
        self.cache.invalidate("dashboard:all").await;
    }
}
