use rusqlite::params;
use crate::db::DbManager;
use std::sync::Arc;
use uuid::Uuid;

pub async fn log_audit(db_manager: Arc<DbManager>, user: &str, action: &str, details: &str) {
    if let Ok(conn) = db_manager.get_system_conn() {
        let _ = conn.execute(
            "INSERT INTO audit_logs (id, user, action, details) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), user, action, details],
        );
    }
}
