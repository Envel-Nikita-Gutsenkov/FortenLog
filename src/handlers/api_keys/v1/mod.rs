pub mod system;
pub mod issues;
pub mod events;
pub mod analytics;
pub mod uptime;

pub use system::*;
pub use issues::*;
pub use events::*;
pub use analytics::*;
pub use uptime::*;

use axum::http::StatusCode;
use std::sync::Arc;
use crate::middleware::api_key::ApiKeyClaims;

pub(crate) fn clamp_limit(requested: Option<i64>) -> i64 {
    requested.unwrap_or(50).clamp(1, 500)
}

pub(crate) fn require_scope(claims: &ApiKeyClaims, scope: &str) -> Result<(), StatusCode> {
    if claims.scopes.iter().any(|s| s == scope) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

pub(crate) async fn check_project_access(
    db: Arc<crate::db::DbManager>,
    claims: &ApiKeyClaims,
    project_id: String,
) -> Result<(), StatusCode> {
    let all = claims.project_ids.iter().any(|p| p == "*");
    if !all && !claims.project_ids.iter().any(|p| *p == project_id) {
        return Err(StatusCode::FORBIDDEN);
    }

    tokio::task::spawn_blocking(move || {
        let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let count: i64 = conn.query_row(
            "SELECT count(*) FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        ).unwrap_or(0);
        if count > 0 {
            Ok(())
        } else {
            Err(StatusCode::NOT_FOUND)
        }
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
}
