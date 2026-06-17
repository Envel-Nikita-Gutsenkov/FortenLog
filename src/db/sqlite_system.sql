CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    retention_days INTEGER DEFAULT 14,
    cache_size_mb INTEGER DEFAULT 256,
    github_repo TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    allowed_projects TEXT, -- Comma-separated project IDs or null for no projects (unless admin)
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    password_change_required INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    last_active TEXT DEFAULT CURRENT_TIMESTAMP,
    is_revoked INTEGER DEFAULT 0,
    FOREIGN KEY(username) REFERENCES users(username)
);
CREATE TABLE IF NOT EXISTS login_history (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    ip TEXT,
    status TEXT, -- 'success', 'fail'
    user_agent TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    user TEXT,
    action TEXT,
    details TEXT
);
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uptime_monitors (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    interval_secs INTEGER DEFAULT 60,
    status TEXT DEFAULT 'unknown'
);
CREATE TABLE IF NOT EXISTS uptime_logs (
    monitor_id TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    latency_ms INTEGER,
    status_code INTEGER,
    is_up INTEGER,
    FOREIGN KEY(monitor_id) REFERENCES uptime_monitors(id)
);
CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    project_id TEXT, -- Scoped to a specific project
    name TEXT NOT NULL,
    config TEXT NOT NULL, -- JSON serialized widget layout
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username)
);
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id BLOB PRIMARY KEY,
    username TEXT NOT NULL,
    credential_data TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username)
);
CREATE TABLE IF NOT EXISTS internal_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    component TEXT NOT NULL,
    error_message TEXT NOT NULL,
    context TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
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
    is_revoked   INTEGER DEFAULT 0,
    FOREIGN KEY(owner) REFERENCES users(username)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner);

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_vacuum', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('pii_anonymization', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('retention_days', '14');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('max_storage_mb', '0'); -- 0 means unlimited
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('auto_purge_enabled', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('compression_age_days', '30');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('enable_internal_error_logging', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_mock_webauthn', 'false');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('max_payload_size_kb', '512');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('ip_rate_limit_rpm', '100');
