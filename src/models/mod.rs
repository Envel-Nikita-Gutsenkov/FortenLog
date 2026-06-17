use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub project_id: String,
    pub issue_id: Option<String>,
    pub hwid: Option<String>,
    pub event_type: String, // "sentry" or "posthog"
    pub payload: Vec<u8>,   // ZSTD compressed JSON
    pub payload_hash: String, 
    pub fingerprint: String, // For stacking/deduplication
    pub ip_address: Option<String>,
    pub os: Option<String>,
    pub browser: Option<String>,
    pub region: Option<String>, // "US", "RU", etc.
    pub tags: Option<serde_json::Value>, // Custom metrics/tags
    pub release_version: Option<String>,
    pub environment: Option<String>,
    pub title: Option<String>,   // e.g. "TypeError"
    pub culprit: Option<String>, // e.g. "main.js in sendToSentry"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionEvent {
    pub id: Uuid,
    pub project_id: String,
    pub hwid: Option<String>,
    pub release_version: Option<String>,
    pub environment: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub is_error: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PermanentStat {
    pub key: String,
    pub value: i64,
    pub last_updated: DateTime<Utc>,
}
