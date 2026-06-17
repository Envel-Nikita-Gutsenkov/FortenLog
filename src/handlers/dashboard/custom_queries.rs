use axum::{extract::State, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use tokio::task;

#[derive(Deserialize, Debug, Clone)]
pub struct CustomQueryFilter {
    pub column: String,
    pub op: String,
    pub value: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct CustomQueryRequest {
    pub project_id: String,
    pub table: String,
    pub metric: String,
    pub dimension: String,
    pub filters: Option<Vec<CustomQueryFilter>>,
}

use std::collections::HashMap;

pub fn extract_custom_property(val: &Value, key: &str) -> Option<String> {
    if let Some(v) = val.get(key) {
        if let Some(s) = v.as_str() { return Some(s.to_string()); }
        if !v.is_null() && !v.is_object() && !v.is_array() { return Some(v.to_string()); }
    }
    if let Some(props) = val.get("properties") {
        if let Some(v) = props.get(key) {
            if let Some(s) = v.as_str() { return Some(s.to_string()); }
            if !v.is_null() && !v.is_object() && !v.is_array() { return Some(v.to_string()); }
        }
    }
    if let Some(tags) = val.get("tags") {
        if let Some(v) = tags.get(key) {
            if let Some(s) = v.as_str() { return Some(s.to_string()); }
            if !v.is_null() && !v.is_object() && !v.is_array() { return Some(v.to_string()); }
        }
    }
    None
}

pub async fn execute_custom_query(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::handlers::auth::Claims>,
    Json(payload): Json<CustomQueryRequest>,
) -> Result<Json<Value>, StatusCode> {
    if !crate::handlers::auth::check_project_access(&state, &claims, &payload.project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);

    let result = task::spawn_blocking(move || {
        {
            let conn = db.get_system_conn().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let exists: bool = conn.query_row(
                "SELECT 1 FROM projects WHERE id = ?1",
                [&payload.project_id],
                |_| Ok(true)
            ).unwrap_or(false);

            if !exists {
                return Err(StatusCode::NOT_FOUND);
            }
        }

        let safe_table = match payload.table.as_str() {
            "events" => "events",
            "sessions" => "sessions",
            _ => return Err(StatusCode::BAD_REQUEST),
        };

        let safe_metric = match payload.metric.as_str() {
            "count" => if safe_table == "events" { "COUNT(e.id)" } else { "COUNT(*)" },
            "unique_users" => if safe_table == "events" { "COUNT(DISTINCT e.hwid)" } else { "COUNT(DISTINCT hwid)" },
            "errors" => if safe_table == "sessions" { "SUM(is_error)" } else { "COUNT(e.id)" },
            _ => return Err(StatusCode::BAD_REQUEST),
        };

        let mut has_custom = payload.dimension.starts_with("custom:");
        if let Some(ref filters) = payload.filters {
            for f in filters {
                if f.column.starts_with("custom:") {
                    has_custom = true;
                }
            }
        }

        let mut sql = if has_custom {
            if safe_table != "events" {
                return Err(StatusCode::BAD_REQUEST);
            }
            "SELECT e.id, e.hwid, e.os, e.browser, e.region, e.release_version, e.environment, e.event_type, COALESCE(e.title, i.title), p.data FROM events e LEFT JOIN issues i ON e.issue_id = i.id LEFT JOIN payloads p ON e.payload_hash = p.hash WHERE 1=1".to_string()
        } else {
            let safe_dimension = match payload.dimension.as_str() {
                "os" => if safe_table == "events" { "e.os" } else { "os" },
                "browser" => if safe_table == "events" { "e.browser" } else { "browser" },
                "region" => if safe_table == "events" { "e.region" } else { "region" },
                "release_version" => if safe_table == "events" { "e.release_version" } else { "release_version" },
                "environment" => if safe_table == "events" { "e.environment" } else { "environment" },
                "event_type" => if safe_table == "events" { "e.event_type" } else { "event_type" },
                "title" => if safe_table == "events" { "COALESCE(e.title, i.title)" } else { "title" },
                _ => return Err(StatusCode::BAD_REQUEST),
            };

            if safe_table == "events" {
                format!(
                    "SELECT {} AS name, {} AS count FROM events e LEFT JOIN issues i ON e.issue_id = i.id WHERE {} IS NOT NULL",
                    safe_dimension, safe_metric, safe_dimension
                )
            } else {
                format!(
                    "SELECT {} AS name, {} AS count FROM {} WHERE {} IS NOT NULL",
                    safe_dimension, safe_metric, safe_table, safe_dimension
                )
            }
        };

        let mut params = Vec::new();

        if let Some(ref filters) = payload.filters {
            for f in filters {
                if f.column.starts_with("custom:") {
                    continue;
                }
                let safe_col = match f.column.as_str() {
                    "os" => if safe_table == "events" { "e.os" } else { "os" },
                    "browser" => if safe_table == "events" { "e.browser" } else { "browser" },
                    "region" => if safe_table == "events" { "e.region" } else { "region" },
                    "release_version" => if safe_table == "events" { "e.release_version" } else { "release_version" },
                    "environment" => if safe_table == "events" { "e.environment" } else { "environment" },
                    "event_type" => if safe_table == "events" { "e.event_type" } else { "event_type" },
                    "title" => if safe_table == "events" { "COALESCE(e.title, i.title)" } else { "title" },
                    "hwid" => if safe_table == "events" { "e.hwid" } else { "hwid" },
                    "is_error" => "is_error",
                    _ => return Err(StatusCode::BAD_REQUEST),
                };
                let safe_op = match f.op.as_str() {
                    "eq" => "=",
                    "neq" => "!=",
                    _ => return Err(StatusCode::BAD_REQUEST),
                };
                sql.push_str(&format!(" AND {} {} ?", safe_col, safe_op));
                params.push(f.value.clone());
            }
        }

        let pool = db.get_project_pool(&payload.project_id).map_err(|_| StatusCode::NOT_FOUND)?;
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if has_custom {
            let mut stmt = conn.prepare(&sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let sqlite_params = rusqlite::params_from_iter(params.iter());
            
            struct RawRow {
                hwid: Option<String>,
                os: Option<String>,
                browser: Option<String>,
                region: Option<String>,
                release_version: Option<String>,
                environment: Option<String>,
                event_type: Option<String>,
                title: Option<String>,
                payload_data: Option<Vec<u8>>,
            }

            let rows = stmt.query_map(sqlite_params, |row| {
                Ok(RawRow {
                    hwid: row.get(1)?,
                    os: row.get(2)?,
                    browser: row.get(3)?,
                    region: row.get(4)?,
                    release_version: row.get(5)?,
                    environment: row.get(6)?,
                    event_type: row.get(7)?,
                    title: row.get(8)?,
                    payload_data: row.get(9)?,
                })
            }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut processed_rows = Vec::new();

            for r in rows {
                let row = r.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                
                let payload_json: Value = if let Some(bytes) = row.payload_data {
                    if let Ok(decompressed) = zstd::stream::decode_all(bytes.as_slice()) {
                        serde_json::from_slice(&decompressed).unwrap_or(Value::Null)
                    } else {
                        Value::Null
                    }
                } else {
                    Value::Null
                };

                let mut matches_filters = true;
                if let Some(ref filters) = payload.filters {
                    for f in filters {
                        if f.column.starts_with("custom:") {
                            let key = &f.column["custom:".len()..];
                            let val_opt = extract_custom_property(&payload_json, key);
                            let val_str = val_opt.unwrap_or_default();
                            let is_eq = val_str == f.value;
                            if (f.op == "eq" && !is_eq) || (f.op == "neq" && is_eq) {
                                matches_filters = false;
                                break;
                            }
                        }
                    }
                }

                if !matches_filters {
                    continue;
                }

                let dimension_val = if payload.dimension.starts_with("custom:") {
                    let key = &payload.dimension["custom:".len()..];
                    extract_custom_property(&payload_json, key).unwrap_or_else(|| "unknown".to_string())
                } else {
                    let std_val = match payload.dimension.as_str() {
                        "os" => row.os,
                        "browser" => row.browser,
                        "region" => row.region,
                        "release_version" => row.release_version,
                        "environment" => row.environment,
                        "event_type" => row.event_type,
                        "title" => row.title,
                        _ => None,
                    };
                    std_val.unwrap_or_else(|| "unknown".to_string())
                };

                processed_rows.push((dimension_val, row.hwid));
            }

            let mut groups: HashMap<String, Vec<Option<String>>> = HashMap::new();
            for (dim, hwid) in processed_rows {
                groups.entry(dim).or_default().push(hwid);
            }

            let mut aggregated = Vec::new();
            for (name, items) in groups {
                let count = match payload.metric.as_str() {
                    "count" | "errors" => items.len() as i64,
                    "unique_users" => {
                        let unique_users: std::collections::HashSet<String> = items.into_iter()
                            .filter_map(|h| h)
                            .collect();
                        unique_users.len() as i64
                    }
                    _ => items.len() as i64,
                };
                aggregated.push(json!({
                    "name": name,
                    "count": count
                }));
            }

            aggregated.sort_by(|a, b| {
                let count_a = a["count"].as_i64().unwrap_or(0);
                let count_b = b["count"].as_i64().unwrap_or(0);
                count_b.cmp(&count_a)
            });
            aggregated.truncate(50);

            Ok::<Value, StatusCode>(json!(aggregated))
        } else {
            let safe_dimension = match payload.dimension.as_str() {
                "os" => if safe_table == "events" { "e.os" } else { "os" },
                "browser" => if safe_table == "events" { "e.browser" } else { "browser" },
                "region" => if safe_table == "events" { "e.region" } else { "region" },
                "release_version" => if safe_table == "events" { "e.release_version" } else { "release_version" },
                "environment" => if safe_table == "events" { "e.environment" } else { "environment" },
                "event_type" => if safe_table == "events" { "e.event_type" } else { "event_type" },
                "title" => if safe_table == "events" { "COALESCE(e.title, i.title)" } else { "title" },
                _ => return Err(StatusCode::BAD_REQUEST),
            };

            sql.push_str(&format!(" GROUP BY {} ORDER BY count DESC LIMIT 50", safe_dimension));

            let mut stmt = conn.prepare(&sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let sqlite_params = rusqlite::params_from_iter(params.iter());
            let rows = stmt.query_map(sqlite_params, |row| {
                Ok(json!({
                    "name": row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "unknown".to_string()),
                    "count": row.get::<_, i64>(1)?,
                }))
            }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut data = Vec::new();
            for r in rows {
                if let Ok(item) = r {
                    data.push(item);
                }
            }

            Ok::<Value, StatusCode>(json!(data))
        }
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
