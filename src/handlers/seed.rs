use axum::{extract::State, response::IntoResponse, http::StatusCode};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;
use crate::models::TelemetryEvent;
use uuid::Uuid;
use chrono::{Utc, Duration};
use rand::seq::SliceRandom;
use rand::Rng;
use serde_json::json;

pub async fn seed_test_data(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<impl IntoResponse, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    tracing::info!("SEEDING_REALISTIC_DATA_STARTED");
    // 1. Create a few projects
    let projects = [
        ("default", "Default Project", "fl_default_key"),
        ("demo-project", "Demo App Desktop", "fl_demo_key"),
        ("web-app", "Web Dashboard", "fl_web_key"),
    ];

    if let Ok(conn) = state.db_manager.get_system_conn() {
        for (id, name, key) in &projects {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO projects (id, name, api_key) VALUES (?1, ?2, ?3)",
                [id, name, key],
            );
        }
        
        let _ = conn.execute(
            "INSERT INTO audit_logs (id, user, action, details) VALUES (?1, ?2, ?3, ?4)",
            [Uuid::new_v4().to_string(), "NN".to_string(), "SEED_DATA".to_string(), "Generated enterprise-grade realistic telemetry dataset".to_string()],
        );
    }

    let error_samples = [
        (
            "Error: Process exited with code: 1",
            "sendToSentry(app/assets/js/preloader)",
            "sentry",
            json!({
                "exception": {
                    "values": [{
                        "type": "Error",
                        "value": "Process exited with code: 1",
                        "stacktrace": {
                            "frames": [
                                {"filename": "app:///app/assets/js/processbuilder.js", "function": "ChildProcess.<anonymous>", "lineno": 289, "colno": 21, "in_app": true},
                                {"filename": "app:///app/assets/js/preloader.js", "function": "sendToSentry", "lineno": 94, "colno": 37, "in_app": true}
                            ]
                        }
                    }]
                },
                "contexts": {
                    "device": {
                        "arch": "x64",
                        "cpu_description": "AMD Ryzen AI 9 HX 370 w/ Radeon 890M",
                        "memory_size": 33393459200u64,
                        "screen_resolution": "3200x2000"
                    },
                    "gpu": {
                        "name": "AMD Radeon(TM) 890M Graphics",
                        "vendor_name": "Advanced Micro Devices, Inc."
                    }
                },
                "breadcrumbs": {
                    "values": [
                        {"category": "console", "level": "info", "message": "[ProcessBuilder]: Disk log analysis failed...", "timestamp": Utc::now().timestamp() - 120},
                        {"category": "console", "level": "info", "message": "[CrashHandler] Analysis returned null.", "timestamp": Utc::now().timestamp() - 60},
                        {"category": "ui.click", "level": "info", "message": "button#play-btn", "timestamp": Utc::now().timestamp() - 30}
                    ]
                }
            })
        ),
        (
            "TypeError: CACHE_DROPIN_MODS is not iterable",
            "saveDropinModConfiguration(app/assets/js/scripts/settings)",
            "sentry",
            json!({
                "exception": {
                    "values": [{
                        "type": "TypeError",
                        "value": "CACHE_DROPIN_MODS is not iterable",
                        "stacktrace": {
                            "frames": [
                                {"filename": "app:///app/assets/js/scripts/settings.js", "function": "saveDropinModConfiguration", "lineno": 412, "colno": 12, "in_app": true}
                            ]
                        }
                    }]
                }
            })
        ),
        ("app_launch", "system", "custom", json!({"version": "2.3.8", "mode": "production"})),
        ("button_click_play", "ui", "custom", json!({"server": "main-1", "user_type": "premium"})),
    ];

    let os_options = ["Windows 11 (10.0.26200)", "Windows 10", "macOS 14.2", "Linux"];
    let browser_options = ["Electron 31 (Chrome 126)", "Electron 30", "Chrome 126"];
    let region_options = ["RU", "US", "DE", "FR"];

    for _ in 0..200 {
        let event = {
            let mut rng = rand::thread_rng();
            let (proj_id, _, _) = projects.choose(&mut rng).unwrap();
            let (title, culprit, ev_type, payload) = {
                let sample = error_samples.choose(&mut rng).unwrap();
                (sample.0, sample.1, sample.2, sample.3.clone())
            };

            let timestamp = Utc::now() - Duration::minutes(rng.gen_range(0..20000));
            let os = os_options.choose(&mut rng).unwrap().to_string();
            let browser = browser_options.choose(&mut rng).unwrap().to_string();
            let region = region_options.choose(&mut rng).unwrap().to_string();
            
            TelemetryEvent {
                id: Uuid::new_v4(),
                timestamp,
                project_id: proj_id.to_string(),
                issue_id: None,
                hwid: Some(format!("hwid-{}", rng.gen_range(1000..9999))),
                event_type: ev_type.to_string(),
                payload: serde_json::to_vec(&payload).unwrap(),
                payload_hash: format!("{:x}", Uuid::new_v4().as_u128()),
                fingerprint: format!("issue-{}", title.chars().take(10).collect::<String>()),
                ip_address: Some(format!("{}.{}.{}.{}", rng.gen_range(1..255), rng.gen_range(1..255), rng.gen_range(1..255), rng.gen_range(1..255))),
                os: Some(os),
                browser: Some(browser),
                region: Some(region),
                tags: None,
                release_version: Some("2.3.8".to_string()),
                environment: Some("production".to_string()),
                title: Some(title.to_string()),
                culprit: if ev_type == "sentry" { Some(culprit.to_string()) } else { None },
            }
        };
        let _ = state.ingest_tx.send(event).await;
    }

    Ok(StatusCode::OK)
}
