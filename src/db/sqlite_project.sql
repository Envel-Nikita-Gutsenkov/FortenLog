CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    culprit TEXT,
    status TEXT DEFAULT 'unhandled',
    count INTEGER DEFAULT 0,
    users_affected INTEGER DEFAULT 0,
    first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    is_suppressed INTEGER DEFAULT 0,
    resolved_in_version TEXT
);

CREATE TABLE IF NOT EXISTS stack_traces (
    hash TEXT PRIMARY KEY,
    normalized TEXT NOT NULL,
    first_seen TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    issue_id TEXT,
    timestamp TEXT,
    event_type TEXT,
    hwid TEXT,
    ip_address TEXT,
    os TEXT,
    browser TEXT,
    region TEXT,
    release_version TEXT,
    environment TEXT,
    stack_hash TEXT,
    payload_hash TEXT,
    title TEXT,
    FOREIGN KEY(issue_id) REFERENCES issues(id),
    FOREIGN KEY(stack_hash) REFERENCES stack_traces(hash)
);

CREATE TABLE IF NOT EXISTS payloads (
    hash TEXT PRIMARY KEY,
    data BLOB,
    size_original INTEGER,
    size_compressed INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    hwid TEXT,
    release_version TEXT,
    environment TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    is_error INTEGER DEFAULT 0
);

-- Analytics rollups for efficient event tracking without full payloads
CREATE TABLE IF NOT EXISTS analytics_rollups (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    properties_hash TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    properties_json TEXT,
    date_bucket TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_rollups_date ON analytics_rollups(date_bucket);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_rollups_unique ON analytics_rollups(event_name, properties_hash, date_bucket);

CREATE INDEX IF NOT EXISTS idx_sessions_release ON sessions(release_version);
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(issue_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_issues_last_seen ON issues(last_seen DESC);
