# FortenLog Implementation Details (Enterprise Architecture)

## 1. Database Architecture
- **System DB (`system.db`)**: Global registry for projects, users, and audit logs. Recently updated to include `system_settings` table for global configuration.
- **Project DBs (`projects/{id}.db`)**: Isolated storage for each project. This ensures data privacy and simplifies backups/deletions per project.
- **Payload Deduplication**: Large JSON payloads are stored in a separate `payloads` table with zstd compression, referenced by hash.

## 2. Ingestion Pipeline
- **Batching**: Events are queued in memory and flushed in batches (default: 1000 events or 5 seconds). This minimizes disk I/O.
- **Stacking/Deduplication**: Burst of identical errors from the same user are limited to 50 events per burst in-memory using `DashMap`.
- **Rate Limiting**: DDoS protection limits ingestion to 100 requests per minute per IP.
- **Custom Event Support**: Now supports non-error telemetry (e.g., `app_launch`, `button_click`) which are aggregated in the Analytics dashboard.

## 3. Security & Compliance
- **GDPR / FZ-152**:
    - **PII Stripping**: Automated stripping of sensitive keys (password, token, api_key) from all incoming payloads.
    - **IP Masking (Delayed for Debugging)**: Client IPs are kept in full for active troubleshooting during the first 14 days (configurable via `gdpr_anonymization_days`). Afterward, the background maintenance worker automatically masks them (e.g., `1.2.3.0`) to comply with GDPR/FZ-152.
    - **HWID (Hardware ID / Persistent Unique ID)**: Client SDKs are required to generate and send a robust, persistent hardware/session identifier (`hwid`/`distinct_id`). This unique value is used as the primary identifier to track affected users instead of dynamic IP addresses, ensuring precise counting.
    - **Automated Retention**: Maintenance worker runs every hour to delete data older than the project's retention policy (default 14 months for resolved/suspended issues).
    - **Audit Logs**: All administrative actions (project creation, manual deletion, seed generation) are logged in the System DB.
- **DSN Security**: The public project key is only used for ingestion. It does not provide access to administrative APIs.
- **Personal Security Bounding**: User credentials, Multi-Factor Authentication (TOTP), and Session revocations are strictly isolated into a localized User Profile security context rather than global server settings.

## 4. Performance & Caching
- **Memory Cache (256MB)**: Powered by `moka`, caching frequently accessed project metadata and recent issues.
- **Async Workers**: Ingestion, Uptime monitoring, and Maintenance run in separate tokio threads to prevent blocking the main API.
- **Integer Safety**: Added `u64` handling for storage metrics to prevent overflows on large datasets.
- **Automated Backup Worker**: A dedicated background cron routine takes lock-free snapshot backups (`twice_daily`, `three_times_weekly`) of the platform to prevent data loss.
- **System Diagnostics**: Native bindings fetch real-time Working Set (RSS) Memory and Process CPU usage alongside internal transaction flushes for health monitoring.

## 5. UI / UX
- **Sentry-grade Design**: Custom CSS system with dual-sidebar navigation, tabbed views, and rich stack trace visualization.
- **Global Scrolling**: Centralized `overflow-y` handling in `#view-content` for consistent scrolling across all modules.
- **Real-time Analytics**: New distribution charts for OS (focus on Electron), Browsers, and Regions.
- **Configurable Settings**: Integrated toggles for Auto-Vacuum, PII Anonymization, and Retention directly in the Storage & Backups view.
- **Export System**: Support for full store export to JSON for external audit or analysis.
- **Corporate Aesthetic Purity**: Strict emoji-free formatting on all audit logs and metrics views, ensuring a sleek, high-end enterprise appearance.

## 6. Development & Testing
- **Realistic Seed Data**: Built-in generator (`/api/system/seed`) that populates the database with hundreds of events using realistic Electron-focused data extracted from user logs.
- **Warning Management**: Strict adherence to Rust compiler standards (all unused imports and variables resolved).
