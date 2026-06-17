pub mod login;
pub mod webauthn;
pub mod totp;
pub mod session;
pub mod history;

pub use login::*;
pub use webauthn::*;
pub use totp::*;
pub use session::*;
pub use history::*;

use axum::{
    async_trait,
    extract::{FromRequestParts, ConnectInfo},
    http::{request::Parts, StatusCode},
};
use std::net::SocketAddr;
use std::sync::Arc;
use crate::handlers::ingest::AppState;

pub struct ClientContext {
    pub ip: String,
    pub user_agent: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for ClientContext
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let addr = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| addr.ip().to_string())
            .unwrap_or_else(|| "0.0.0.0".to_string());

        let user_agent = parts
            .headers
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        Ok(ClientContext {
            ip: addr,
            user_agent,
        })
    }
}

pub async fn check_project_access(
    state: &Arc<AppState>,
    claims: &Claims,
    project_id: &str,
) -> bool {
    if claims.is_admin {
        return true;
    }
    if project_id == "all" {
        return false;
    }
    
    let db = Arc::clone(&state.db_manager);
    let username = claims.sub.clone();
    let pid = project_id.to_string();
    
    tokio::task::spawn_blocking(move || {
        if let Ok(conn) = db.get_system_conn() {
            let allowed_projects: Option<String> = conn.query_row(
                "SELECT allowed_projects FROM users WHERE username = ?1",
                [&username],
                |row| row.get::<_, Option<String>>(0)
            ).unwrap_or(None);
            
            if let Some(allowed) = allowed_projects {
                let allowed_str = allowed.clone();
                allowed_str.split(',')
                    .map(|s| s.trim())
                    .any(|x| x == pid)
            } else {
                false
            }
        } else {
            false
        }
    }).await.unwrap_or(false)
}
