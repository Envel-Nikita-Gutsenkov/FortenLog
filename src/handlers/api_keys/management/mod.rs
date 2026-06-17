pub mod list;
pub mod create;
pub mod update;
pub mod revoke;

pub use list::*;
pub use create::*;
pub use update::*;
pub use revoke::*;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub project_ids: Vec<String>,
    pub scopes: Vec<String>,
    pub allowed_ips: Option<Vec<String>>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub allowed_ips: Option<Vec<String>>,
    pub expires_at: Option<String>,
}

pub(crate) fn hash_key(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    format!("{:x}", h.finalize())
}

pub(crate) fn validate_scopes(scopes: &[String]) -> bool {
    const VALID: &[&str] = &["issues:read", "events:read", "stats:read", "uptime:read"];
    !scopes.is_empty() && scopes.iter().all(|s| VALID.contains(&s.as_str()))
}

pub(crate) fn validate_ip_or_cidr(ip: &str) -> bool {
    if let Some((addr, mask_str)) = ip.split_once('/') {
        if let Ok(ip_addr) = addr.parse::<std::net::IpAddr>() {
            if let Ok(mask) = mask_str.parse::<u8>() {
                match ip_addr {
                    std::net::IpAddr::V4(_) => mask <= 32,
                    std::net::IpAddr::V6(_) => mask <= 128,
                }
            } else {
                false
            }
        } else {
            false
        }
    } else {
        ip.parse::<std::net::IpAddr>().is_ok()
    }
}
