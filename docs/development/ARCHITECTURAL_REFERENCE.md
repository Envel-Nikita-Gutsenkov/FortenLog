# FortenLog Codebase Directory Structure & Engineering Standards

This document serves as an exhaustive architectural reference and development guide for the FortenLog telemetry platform. Use it to quickly map files and follow established coding standards for performance, security, and verification.

---

## 1. Directory Tree Structure

```text
FortenLog/
├── .gitignore                    # Git exclusions
├── Cargo.toml                    # Rust crate dependencies and build configurations
├── Cargo.lock                    # Locked dependency versions
├── Dockerfile                    # Docker build configuration for release
├── docker-compose.yml            # Multi-container local execution setup
├── README.md                     # General product overview
├── setup.sh                      # Shell automation script for Linux deployment
├── setup.ps1                     # PowerShell automation script for Windows deployment
├── data/                         # Local database storage path (system.db, project DBs)
├── docs/                         # Platform documentation
│   ├── BACKUP_AND_RESTORE.md     # SQLite hot/manual backup and disaster recovery guide
│   ├── IMPLEMENTATION_DETAILS.md # Technical insights (deduplication, DB pooling, retention)
│   ├── SYSTEM_ARCHITECTURE.md    # Multi-tenant storage architecture, queues, caches, and flowcharts
│   ├── USER_INTERFACE_GUIDE.md   # UX theme, color palettes, panels, and dashboard widgets
│   ├── WIDGET_SCHEMA.md          # Custom analytical widget JSON schema specs
│   ├── architecture/
│   │   └── overview.md           # Visual diagrams of ingestion pipelines and queues
│   ├── deployment/
│   │   └── docker.md             # Enterprise container deployment and VPS deployer guide
│   ├── security/
│   │   └── hardening.md          # Security hardening checklists (Argon2, CSRF, TOTP)
│   └── development/
│       └── ARCHITECTURAL_REFERENCE.md  # [This File] Codebase map and coding guidelines
├── src/                          # Backend source code (Rust)
│   ├── main.rs                   # App entrypoint, async task setup, and Axum routing
│   ├── lib.rs                    # Shared crate declarations for integration tests
│   ├── security.rs               # Argon2 complexity validation and crypto helpers
│   ├── ui.rs                     # Asset embedding router configurations
│   ├── bin/
│   │   └── seed_data.rs          # CLI tool for generating realistic multi-project telemetry data
│   ├── db/
│   │   └── mod.rs                # SQLite multi-tenant DB manager and pooled connections
│   ├── models/
│   │   └── mod.rs                # Shared telemetry, event, and database schemas
│   ├── middleware/
│   │   ├── mod.rs                # Middleware index
│   │   └── auth.rs               # CSRF, session binding, and public routing bypass
│   └── handlers/
│       ├── mod.rs                # Router handler indexing
│       ├── explorer.rs           # Multi-dimensional telemetry log browsers
│       ├── export.rs             # System JSON/CSV data export handlers
│       ├── maintenance.rs        # Auto-vacuuming, storage policies, and GDPR data retention
│       ├── seed.rs               # In-app realistic telemetry mock seed generators
│       ├── settings_audit.rs     # Immutable administrator audit logging engines
│       ├── uptime.rs             # Non-blocking concurrent TCP/HTTP status pingers
│       ├── users.rs              # Administrator CRUD actions and identity management
│       ├── api_keys/
│       │   ├── mod.rs            # API key routing
│       │   ├── management/       # API key management (create, list, update, revoke)
│       │   └── v1/               # v1 REST API endpoint verification handlers
│       ├── auth/
│       │   ├── mod.rs            # Authentication sub-routing
│       │   ├── login.rs          # Credential verification and session generation
│       │   ├── session.rs        # Session state query and revocation systems
│       │   ├── totp.rs           # Google Authenticator/2FA QR and TOTP verification
│       │   └── webauthn.rs       # Passkey / Yubikey registration and authentication
│       ├── dashboard/
│       │   ├── mod.rs            # Dashboard metrics and custom SQL router
│       │   ├── custom_dashboards.rs # Custom dashboard CRUD handlers
│       │   ├── custom_queries.rs # Admin raw SQL execution console handler
│       │   └── overview.rs       # Aggregated overview metrics (Browser, OS, Geo)
│       ├── ingest/
│       │   ├── mod.rs            # AppState declarations and telemetry cache buffers
│       │   ├── capture.rs        # PostHog-compatible payload capture, size limits, and rate limits
│       │   ├── envelope.rs       # Sentry-compatible Envelope parser & pipeline
│       │   ├── worker.rs         # Ingest pipeline flusher, deduplication, and flush worker
│       │   └── utils.rs          # PII strippers, region resolvers, and hash calculators
│       ├── issues/
│       │   ├── mod.rs            # Issue triage routes
│       │   ├── delete.rs         # Issue deletion handler
│       │   ├── details.rs        # Issue detail viewer and stack traces
│       │   ├── list.rs           # Issue stream browser
│       │   └── update.rs         # Update issue state (resolve, ignore)
│       └── settings/
│           ├── mod.rs            # Settings route setup
│           ├── projects.rs       # Project CRUD & DSN token management
│           ├── storage.rs        # Storage limits, auto-vacuum, and backup triggers
│           └── system.rs         # Global system configuration parameters
├── tests/
│   ├── api_keys_test.rs          # Integration tests for administrative API key scopes & IP restrictions
│   ├── generate_mock.js          # Node script for generating rich mock telemetry & geographical test logs
│   ├── integration_test.rs       # End-to-End integration testing for Sentry/PostHog ingestion
│   └── stress_test.rs            # Load and concurrency tests for project databases
└── ui/                           # Embedded Frontend UI Assets
    ├── index.html                # Main SPA shell
    ├── style.css                 # Sentry-grade custom CSS rulesets
    └── app.js                    # SPA state machine, dashboard rendering, WebAuthn flows
```

---

## 2. Developer Quality Standards & Principles

Every code change, refactoring step, or feature implementation must satisfy the following strict requirements.

### A. Security & Vulnerability Controls
1. **Stealth Mode Enforcement**: Never expose verbose system error traces (e.g., SQLite syntax errors, missing columns, or exact auth failures) to public client APIs. Convert internal errors to generic messages (like `StatusCode::UNAUTHORIZED` or `StatusCode::NOT_FOUND` if stealth mode is enabled).
2. **Session Binding**: Ensure all non-public API handlers validate session integrity. Sessions must remain strictly bound to the user's IP Address and User-Agent. Any deviation triggers HTTP `401 Unauthorized`.
3. **Database Input Cleansing**: Use parameterized SQL statements for *all* SQLite queries. Under no circumstance should client inputs be raw-concatenated into SQL scripts (protect against SQL injections).
4. **GDPR Compliance**: Do not persist raw client IPs beyond active debugging periods (default: 14 days). Ensure the background worker `perform_compression` runs periodic IP-masking updates.

### B. High Performance & Optimization
1. **Minimizing DB Contention**: Never hold SQLite database locks or rusqlite `Transaction` structures across async `.await` boundaries. Pre-fetch, calculate, and query external caches (like Moka caches or DashMaps) *before* opening the SQLite write transactions.
2. **Lockless Telemetry Queues**: Utilize Axum-spanned Tokio channels (`mpsc`) for asynchronous ingestion. Use non-blocking `try_send` under high-pressure scenarios to quickly reject requests (HTTP 429) rather than bottlenecking the server or blocking Tokio runtime threads.
3. **No Unnecessary Clones**: Leverage Rust references (`&T`) or reference-counted wrappers (`Arc<T>`) wherever possible. Avoid duplicate data copying in hot telemetry endpoints.

### C. Reliability & Fault-Tolerance
1. **Queue Backpressure**: Limit ingestion channels strictly. Ensure our ingest pipelines cannot run the host system out of memory (OOM). Hard limits must exist for payload buffers (max 2MB per issue body).
2. **Circuit Breakers**: Always monitor incoming issues using in-memory caches. If a single problem accumulates logs faster than 100 RPM, dynamically drop the body telemetry insertion step while safely incrementing base counters.
3. **Graceful Failures**: If network components (e.g. SMTP server) or remote services time out, fail gracefully. Log detailed administrative audit reports without halting core telemetry pipelines.

### D. Automated and Integration Testing
1. **Strict Local Validation**: Every modification to handlers, ingest, or DB schemes must build cleanly without compilation warnings (`cargo check` or `cargo test` run as standard procedure).
2. **End-to-End Test Integrity**: Write regression tests under the `tests/` directory for any new API, filter parameter, or telemetry route.
3. **Mock Data Cleanliness**: Ensure mock directories generated during tests are properly deleted in `finally` clean-up blocks (`std::fs::remove_dir_all`) to prevent residual test state corruption.

### E. Code Cleanliness & Architectural Integrity (Zero-Spaghetti Policy)
1. **Anti-Spaghetti Code Checks**: When adding any new feature or refactoring code, strictly inspect the codebase to prevent unstructured, tangled, or deeply nested logic flows. Maintain a strict separation of concerns—handlers handle requests, models represent data structures, db manages raw execution, and middleware handles cross-cutting aspects.
2. **Beautiful & Maintainable Structure**: Every module must be written cleanly, using descriptive and consistent names, idiomatic Rust formatting, and comprehensive comments for non-obvious engineering decisions. Maintain modularity so that individual components remain simple to understand, audit, and refactor.
3. **Correct & Safe Architecture**: Verify that new code does not introduce security vulnerabilities or architectural violations. Always ensure correct database connection lifecycle management, strict data isolation boundaries, and appropriate type safety constraints. Do not sacrifice clean architectural layout for temporary hacks.
