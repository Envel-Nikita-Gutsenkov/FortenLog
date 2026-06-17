use rusqlite::Connection;
use serde_json::{json, Value};
use uuid::Uuid;
use chrono::Utc;
use zstd::stream::encode_all;
use sha2::Digest;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("[SEEDING] Initializing FortenLog realistic test data...");

    // 1. Ensure system database exists and project "default" is registered
    std::fs::create_dir_all("./data/projects")?;
    let sys_conn = Connection::open("./data/system.db")?;

    sys_conn.execute_batch("
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            retention_days INTEGER DEFAULT 14,
            cache_size_mb INTEGER DEFAULT 256,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            totp_secret TEXT,
            totp_enabled INTEGER DEFAULT 0,
            failed_attempts INTEGER DEFAULT 0,
            locked_until TEXT,
            last_login_at TEXT
        );
    ")?;

    // Create default project if not exists
    let default_api_key = "fl_04182f28b4414a7695973e054683e04b";
    sys_conn.execute(
        "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES ('default', 'Default Project', ?1)",
        [default_api_key],
    )?;

    println!("[SEEDING] Registered 'default' project in system DB.");

    // 2. Open / create projects/default.db and initialize tables
    let _ = std::fs::remove_file("./data/projects/default.db");
    let p_conn = Connection::open("./data/projects/default.db")?;
    p_conn.execute_batch("
        PRAGMA journal_mode=WAL;
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
    ")?;

    // Dynamically ensure new columns exist in older databases
    let _ = p_conn.execute("ALTER TABLE issues ADD COLUMN is_suppressed INTEGER DEFAULT 0", []);
    let _ = p_conn.execute("ALTER TABLE issues ADD COLUMN resolved_in_version TEXT", []);

    // Clean existing dummy issues/events to provide a fresh, beautiful, clean state
    p_conn.execute("DELETE FROM events", [])?;
    p_conn.execute("DELETE FROM issues", [])?;
    p_conn.execute("DELETE FROM payloads", [])?;
    p_conn.execute("DELETE FROM stack_traces", [])?;
    p_conn.execute("DELETE FROM sessions", [])?;

    // 3. Helper to insert an issue, stack trace, events, sessions, and compressed payloads
    let insert_issue = |
        id: &str,
        title: &str,
        culprit: &str,
        status: &str,
        count: i32,
        users_affected: i32,
        first_seen: &str,
        last_seen: &str,
        resolved_in_version: Option<&str>,
        normalized_stack: &str,
        os: &str,
        browser: &str,
        region: &str,
        cpu: &str,
        gpu: &str,
        ram_gb: f64,
        resolution: &str,
        release_version: &str,
        environment: &str,
        breadcrumbs_json: Value,
        exception_values: Value,
        request_url: &str,
        handled: bool
    | -> Result<(), Box<dyn std::error::Error>> {
        p_conn.execute(
            "INSERT INTO issues (id, title, culprit, status, count, users_affected, first_seen, last_seen, is_suppressed, resolved_in_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
            rusqlite::params![id, title, culprit, status, count, users_affected, first_seen, last_seen, resolved_in_version],
        )?;

        let stack_hash = format!("{:x}", sha2::Sha256::digest(normalized_stack.as_bytes()));
        p_conn.execute(
            "INSERT OR IGNORE INTO stack_traces (hash, normalized, first_seen) VALUES (?1, ?2, ?3)",
            rusqlite::params![stack_hash, normalized_stack, first_seen],
        )?;

        // Insert multiple events to match counts and users affected
        for u in 0..users_affected {
            let hwid = format!("hwid_user_{}_{}", id.replace(":", "_"), u);
            let ip = format!("192.168.1.{}", 10 + u);
            let event_id = Uuid::new_v4().to_string();

            // Create Sentry payload
            let sentry_payload = json!({
                "id": event_id,
                "timestamp": Utc::now().timestamp(),
                "level": "error",
                "release": release_version,
                "environment": environment,
                "request": {
                    "url": request_url
                },
                "contexts": {
                    "device": {
                        "architecture": "x64",
                        "boot_time": "2026-05-17T03:06:33.154Z",
                        "cpu_description": cpu,
                        "family": "Desktop",
                        "free_memory": ((ram_gb * 0.5) * 1024.0 * 1024.0 * 1024.0) as u64,
                        "memory_size": (ram_gb * 1024.0 * 1024.0 * 1024.0) as u64,
                        "processor_count": 8,
                        "processor_frequency": 2112,
                        "screen_density": 1.5,
                        "screen_height_pixels": serde_json::Value::Null,
                        "screen_resolution": resolution,
                        "screen_width_pixels": serde_json::Value::Null,
                        "id": hwid
                    },
                    "gpu": {
                        "name": gpu
                    },
                    "os": {
                        "name": os,
                        "version": "10.0"
                    },
                    "browser": {
                        "name": browser,
                        "version": "142.0"
                    }
                },
                "exception": {
                    "values": exception_values
                },
                "breadcrumbs": {
                    "values": breadcrumbs_json
                },
                "tags": {
                    "url": request_url,
                    "release": release_version,
                    "environment": environment,
                    "handled": handled.to_string(),
                    "level": "error"
                }
            });

            let payload_str = sentry_payload.to_string();
            let payload_compressed = encode_all(payload_str.as_bytes(), 3)?;
            let payload_hash = format!("{:x}", sha2::Sha256::digest(&payload_compressed));

            p_conn.execute(
                "INSERT OR IGNORE INTO payloads (hash, data, size_original, size_compressed) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![payload_hash, payload_compressed, payload_str.len() as i32, payload_compressed.len() as i32],
            )?;

            p_conn.execute(
                "INSERT INTO events (id, issue_id, timestamp, event_type, hwid, ip_address, os, browser, region, release_version, environment, stack_hash, payload_hash)
                 VALUES (?1, ?2, ?3, 'sentry', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    event_id,
                    id,
                    last_seen,
                    hwid,
                    ip,
                    os,
                    browser,
                    region,
                    release_version,
                    environment,
                    stack_hash,
                    payload_hash
                ],
            )?;

            // Insert matching sessions to make release statistics accurate and beautiful
            for _ in 0..5 {
                p_conn.execute(
                    "INSERT INTO sessions (id, hwid, release_version, environment, timestamp, is_error)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                    rusqlite::params![
                        Uuid::new_v4().to_string(),
                        hwid,
                        release_version,
                        environment,
                        last_seen
                    ]
                )?;
            }
        }

        // Add extra successful sessions for premium adoption metrics and >99% stability
        for s in 0..300 {
            p_conn.execute(
                "INSERT INTO sessions (id, hwid, release_version, environment, timestamp, is_error)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    format!("hwid_ok_{}", s),
                    release_version,
                    environment,
                    last_seen
                ]
            )?;
        }

        Ok(())
    };

    // --- ISSUE 1: TypeError: CACHE_DROPIN_MODS is not iterable ---
    println!("[SEEDING] Seeding TypeError issue...");
    insert_issue(
        "default-TypeError-CACHE_DROPIN_MODS is not iterable",
        "TypeError: CACHE_DROPIN_MODS is not iterable",
        "app:///app/assets/js/scripts/settings.js:948:19 in saveDropinModConfiguration",
        "unhandled",
        123,
        3,
        "2026-05-16T12:00:00Z",
        "2026-05-17T18:30:00Z",
        None,
        "saveDropinModConfiguration\nfullSettingsSave\nsettingsNavDone.onclick",
        "Windows",
        "Chrome",
        "New York, USA (US)",
        "11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz",
        "Intel(R) UHD Graphics",
        8.0,
        "1920x1080",
        "2.3.8",
        "production",
        json!([
            {
                "timestamp": Utc::now().timestamp() - 60,
                "category": "info",
                "message": "[LaunchController] Saved new config file to disk",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 30,
                "category": "info",
                "message": "[LaunchController] MIXIN Subsystem Version=0.8.7 initialized",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 5,
                "category": "error",
                "message": "TypeError: CACHE_DROPIN_MODS is not iterable",
                "level": "error"
            }
        ]),
        json!([
            {
                "type": "TypeError",
                "value": "CACHE_DROPIN_MODS is not iterable",
                "mechanism": {
                    "handled": false
                },
                "stacktrace": {
                    "frames": [
                        {
                            "function": "settingsNavDone.onclick",
                            "filename": "app:///app/assets/js/scripts/settings.js",
                            "lineno": 334,
                            "context_line": "    settingsNavDone.onclick = fullSettingsSave;",
                            "pre_context": [
                                "    // Trigger full save configuration",
                                "    let settingsNavDone = document.getElementById('btn-save-settings');"
                            ],
                            "post_context": [
                                "}",
                                "module.exports = { initSettings }"
                            ]
                        },
                        {
                            "function": "fullSettingsSave",
                            "filename": "app:///app/assets/js/scripts/settings.js",
                            "lineno": 328,
                            "context_line": "    saveDropinModConfiguration();",
                            "pre_context": [
                                "function fullSettingsSave() {",
                                "    console.log('[Settings] Saving all values...')"
                            ],
                            "post_context": [
                                "    console.log('[Settings] Save finished successfully.')"
                            ]
                        },
                        {
                            "function": "saveDropinModConfiguration",
                            "filename": "app:///app/assets/js/scripts/settings.js",
                            "lineno": 948,
                            "context_line": "    for (const mod of CACHE_DROPIN_MODS) {",
                            "pre_context": [
                                "function saveDropinModConfiguration() {",
                                "    let activeMods = [];"
                            ],
                            "post_context": [
                                "        activeMods.push(mod.name);",
                                "    }"
                            ]
                        }
                    ]
                }
            }
        ]),
        "app:///app/app.ejs",
        false
    )?;

    // --- ISSUE 2: RequestError: self signed certificate ---
    println!("[SEEDING] Seeding RequestError issue...");
    insert_issue(
        "default-RequestError-self signed certificate",
        "RequestError: self signed certificate",
        "app:///node_modules/@envel/helios-core/node_modules/got/dist/source/core/index.js:970:111 in ClientRequest.<anonymous>",
        "unhandled",
        57,
        2,
        "2026-05-16T15:00:00Z",
        "2026-05-17T17:15:00Z",
        None,
        "ClientRequest.<anonymous>",
        "Windows",
        "Chrome",
        "Tokyo, Japan (JP)",
        "Intel(R) Core(TM) i3-9100 CPU @ 3.60GHz",
        "Intel(R) UHD Graphics 630",
        8.0,
        "1366x768",
        "2.3.8",
        "production",
        json!([
            {
                "timestamp": Utc::now().timestamp() - 120,
                "category": "info",
                "message": "[DownloadEngine] Download failed for https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.19%2B10/OpenJDK17U-jdk_x64_windows_hotspot_17.0.19_10.zip",
                "level": "error"
            },
            {
                "timestamp": Utc::now().timestamp() - 60,
                "category": "info",
                "message": "[AutoUpdater] No new update found.",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 20,
                "category": "ui.click",
                "message": "div#overlayActionContainer > button#overlayAcknowledge",
                "level": "info"
            }
        ]),
        json!([
            {
                "type": "RequestError",
                "value": "self signed certificate",
                "mechanism": {
                    "handled": false
                },
                "stacktrace": {
                    "frames": [
                        {
                            "function": "ClientRequest.<anonymous>",
                            "filename": "app:///node_modules/@envel/helios-core/node_modules/got/dist/source/core/index.js",
                            "lineno": 970,
                            "context_line": "            error = error instanceof timed_out_1.TimeoutError ? new TimeoutError(error, this.timings, this) : new RequestError(error.message);",
                            "pre_context": [
                                "        });",
                                "        request.once('error', (error) => {",
                                "            var _a;",
                                "            request.destroy();"
                            ],
                            "post_context": [
                                "            this._beforeError(error);",
                                "        });"
                            ]
                        }
                    ]
                }
            }
        ]),
        "app:///app/app.ejs",
        false
    )?;

    // --- ISSUE 3: Error: Process exited with code: 1 ---
    println!("[SEEDING] Seeding Process exited issue...");
    insert_issue(
        "default-Error-Process exited with code: 1",
        "Error: Process exited with code: 1",
        "app:///app/assets/js/preloader.js:94:37 in sendToSentry",
        "unhandled",
        312,
        5,
        "2026-05-15T09:00:00Z",
        "2026-05-17T19:05:00Z",
        None,
        "ChildProcess.<anonymous>\nsendToSentry",
        "Windows",
        "Chrome",
        "Berlin, Germany (DE)",
        "AMD Ryzen AI 9 HX 370 w/ Radeon 890M",
        "AMD Radeon(TM) 890M Graphics",
        32.0,
        "3200x2000",
        "2.3.8",
        "production",
        json!([
            {
                "timestamp": Utc::now().timestamp() - 200,
                "category": "info",
                "message": "[2026-05-13 13:16:19] [info] [ProcessBuilder]: Disk log analysis failed or incomplete. Analyzing memory buffer...",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 100,
                "category": "info",
                "message": "[CrashHandler DEBUG] Context around Exception: Minecraft Crash Report description: Game crash description",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 10,
                "category": "info",
                "message": "[CrashHandler] Analysis returned null.",
                "level": "info"
            }
        ]),
        json!([
            {
                "type": "Error",
                "value": "Process exited with code: 1",
                "mechanism": {
                    "handled": true
                },
                "stacktrace": {
                    "frames": [
                        {
                            "function": "ChildProcess.<anonymous>",
                            "filename": "app:///app/assets/js/processbuilder.js",
                            "lineno": 289,
                            "context_line": "    sendToSentry(exitMessage, 'error');",
                            "pre_context": [
                                "    child.on('exit', (code) => {",
                                "        if (code !== 0) {"
                            ],
                            "post_context": [
                                "        }",
                                "    });"
                            ]
                        },
                        {
                            "function": "sendToSentry",
                            "filename": "app:///app/assets/js/preloader.js",
                            "lineno": 94,
                            "context_line": "    Sentry.captureException(new Error(message));",
                            "pre_context": [
                                "function sendToSentry(message, type = 'info') {",
                                "    if (Sentry) {",
                                "        if (type === 'error') {"
                            ],
                            "post_context": [
                                "        }",
                                "    }",
                                "}"
                            ]
                        }
                    ]
                }
            }
        ]),
        "app:///app/app.ejs",
        true
    )?;

    // --- ISSUE 4: Error: Game Crash: java.nio.file.FileSystemException ---
    println!("[SEEDING] Seeding Game Crash resolved issue...");
    insert_issue(
        "default-Error-Game Crash: java.nio.file.FileSystemException",
        "Error: Game Crash: java.nio.file.FileSystemException",
        "app:///app/assets/js/preloader.js:94:37 in sendToSentry",
        "resolved",
        14,
        1,
        "2026-05-14T08:00:00Z",
        "2026-05-15T22:45:00Z",
        Some("2.3.8"),
        "ChildProcess.<anonymous>\nGameCrashHandler.handleExit\nGameCrashHandler.showGenericCrashOverlay\nsendToSentry",
        "Windows",
        "Chrome",
        "London, UK",
        "AMD Ryzen 5 5600X 6-Core Processor",
        "NVIDIA GeForce RTX 3060",
        16.0,
        "1920x1080",
        "2.3.7",
        "production",
        json!([
            {
                "timestamp": Utc::now().timestamp() - 1000,
                "category": "info",
                "message": "[LaunchController] Starting server pings...",
                "level": "info"
            },
            {
                "timestamp": Utc::now().timestamp() - 500,
                "category": "error",
                "message": "java.nio.file.FileSystemException: C:\\Users\\User\\AppData\\Roaming\\.minecraft\\bin\\minecraft.jar: The process cannot access the file because it is being used by another process.",
                "level": "error"
            }
        ]),
        json!([
            {
                "type": "Error",
                "value": "Game Crash: java.nio.file.FileSystemException",
                "mechanism": {
                    "handled": true
                },
                "stacktrace": {
                    "frames": [
                        {
                            "function": "ChildProcess.<anonymous>",
                            "filename": "app:///app/assets/js/processbuilder.js",
                            "lineno": 289,
                            "context_line": "    sendToSentry(exitMessage, 'error');",
                            "pre_context": [
                                "    child.on('exit', (code) => {",
                                "        if (code !== 0) {"
                            ],
                            "post_context": [
                                "        }",
                                "    });"
                            ]
                        },
                        {
                            "function": "GameCrashHandler.handleExit",
                            "filename": "app:///app/assets/js/preloader.js",
                            "lineno": 156,
                            "context_line": "    this.showGenericCrashOverlay(err);",
                            "pre_context": [
                                "class GameCrashHandler {",
                                "    handleExit(err) {"
                            ],
                            "post_context": [
                                "    }"
                            ]
                        },
                        {
                            "function": "GameCrashHandler.showGenericCrashOverlay",
                            "filename": "app:///app/assets/js/preloader.js",
                            "lineno": 178,
                            "context_line": "    sendToSentry(err.message, 'error');",
                            "pre_context": [
                                "    showGenericCrashOverlay(err) {",
                                "        console.error('Crash detected:', err);"
                            ],
                            "post_context": [
                                "    }"
                            ]
                        },
                        {
                            "function": "sendToSentry",
                            "filename": "app:///app/assets/js/preloader.js",
                            "lineno": 94,
                            "context_line": "    Sentry.captureException(new Error(message));",
                            "pre_context": [
                                "function sendToSentry(message, type = 'info') {",
                                "    if (Sentry) {",
                                "        if (type === 'error') {"
                            ],
                            "post_context": [
                                "        }",
                                "    }",
                                "}"
                            ]
                        }
                    ]
                }
            }
        ]),
        "app:///app/app.ejs",
        true
    )?;

    println!("[SEEDING] Seeding complete! Database populated with beautiful, premium, realistic telemetry data.");
    Ok(())
}
