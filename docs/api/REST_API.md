# FortenLog REST API v1

FortenLog provides a comprehensive programmatic API to query telemetry, issues, analytics, and uptime data.

## Authentication

All `v1` endpoints require an API Key. Keys are passed via the standard `Authorization` header as a Bearer token.
```http
Authorization: Bearer flpat_1234567890abcdef...
```

You can create API keys in the FortenLog Dashboard under **Settings > API Keys** (requires admin privileges).
Keys are cryptographically hashed and cannot be retrieved after creation. They also enforce **Scopes** and optionally **IP Allowlists**.

## Base URL
All API paths listed below are relative to your FortenLog domain.
`https://your-fortenlog-domain.com/v1/...`

---

## 1. System & Projects

### `GET /v1/system`
Returns system metadata and the list of projects the current API key is authorized to access.
**Requires scope:** None (requires a valid API key).

### `GET /v1/projects`
List all projects accessible by this key.
**Requires scope:** `stats:read`

---

## 2. Issues

### `GET /v1/projects/:project_id/issues`
List issues (groups of events) for a specific project.
**Requires scope:** `issues:read`
**Query Parameters:**
- `limit` (default: 50, max: 500)
- `offset` (default: 0)
- `status` (unhandled, resolved, ignored)
- `q` (search by title or culprit)
- `sort` (last_seen, first_seen, count, users_affected)

### `GET /v1/projects/:project_id/issues/:issue_id`
Get detailed information for a specific issue.
**Requires scope:** `issues:read`

---

## 3. Events

### `GET /v1/projects/:project_id/events`
List raw events within a project.
**Requires scope:** `events:read`
**Query Parameters:**
- `limit`, `offset`
- `event_type` (e.g. error, log, crash)
- `environment`
- `release`
- `since`, `until` (ISO8601 strings)

### `GET /v1/projects/:project_id/issues/:issue_id/events`
List all events belonging to a specific issue.
**Requires scope:** `events:read`

### `GET /v1/projects/:project_id/issues/:issue_id/events/:event_id`
Get full details of a specific event, including the decompressed JSON payload containing the stack trace or breadcrumbs.
**Requires scope:** `events:read`

---

## 4. Analytics & Stats

### `GET /v1/projects/:project_id/stats`
Returns aggregated statistics for the project (total events, issues, top OS, browsers, releases, and environments).
**Requires scope:** `stats:read`

### `GET /v1/projects/:project_id/analytics`
Fetch PostHog-style analytics rollups and timeseries data.
**Requires scope:** `stats:read`
**Query Parameters:**
- `since`, `until` (ISO8601 strings)
- `granularity` (day, week, month; default: day)

### `GET /v1/projects/:project_id/sessions`
List session and crash rate data.
**Requires scope:** `stats:read`
**Query Parameters:**
- `limit`, `offset`

---

## 5. Uptime Monitoring

### `GET /v1/projects/:project_id/uptime`
List all uptime monitors for the project and their current 24-hour SLA statuses.
**Requires scope:** `uptime:read`

### `GET /v1/projects/:project_id/uptime/:monitor_id/logs`
List recent ping logs for a specific monitor.
**Requires scope:** `uptime:read`
**Query Parameters:**
- `limit` (default: 100)
- `since`
