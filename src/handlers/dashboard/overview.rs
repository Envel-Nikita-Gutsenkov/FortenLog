use axum::{extract::{State, Query}, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use tokio::task;

#[derive(Deserialize)]
pub struct DashboardParams {
    pub project_id: Option<String>,
}

pub async fn get_dashboard_stats(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<crate::handlers::auth::Claims>,
    Query(params): Query<DashboardParams>,
) -> Result<Json<Value>, StatusCode> {
    let project_id = params.project_id.clone().unwrap_or_else(|| "all".to_string());

    if !crate::handlers::auth::check_project_access(&state, &claims, &project_id).await {
        return Err(StatusCode::FORBIDDEN);
    }

    let cache_key = format!("dashboard:{}", project_id);
    
    if project_id != "all" {
        let cache = state.db_manager.get_project_cache(&project_id);
        if let Some(cached) = cache.get(&cache_key).await {
            return Ok(Json(cached));
        }
    } else {
        if let Some(cached) = state.db_manager.cache.get(&cache_key).await {
            return Ok(Json(cached));
        }
    }

    let db = Arc::clone(&state.db_manager);
    let project_filter = params.project_id.clone();
    
    let result = task::spawn_blocking(move || {
        let mut projects = Vec::new();
        if let Ok(conn) = db.get_system_conn() {
            let mut stmt = conn.prepare("SELECT id, name, api_key, created_at FROM projects").ok()?;
            projects = stmt.query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "api_key": row.get::<_, String>(2)?,
                    "created_at": row.get::<_, String>(3)?,
                }))
            }).ok()?.filter_map(|r| r.ok()).collect();
        }

        let mut all_issues = Vec::new();
        let mut os_dist = std::collections::HashMap::new();
        let mut browser_dist = std::collections::HashMap::new();
        let mut region_dist = std::collections::HashMap::new();
        let mut release_dist = std::collections::HashMap::new();

        let filtered_projects: Vec<Value> = match project_filter.as_deref() {
            Some("all") | None => projects.clone(),
            Some(pid) => projects.iter().filter(|p| p["id"].as_str() == Some(pid)).cloned().collect(),
        };

        for p in &filtered_projects {
            let id = p["id"].as_str()?;
            if let Ok(pool) = db.get_project_pool(id) {
                if let Ok(conn) = pool.get() {
                    let mut stmt = conn.prepare(
                        "SELECT id, title, culprit, status, count, users_affected, last_seen, is_suppressed, resolved_in_version \
                         FROM issues ORDER BY last_seen DESC LIMIT 50"
                    ).ok()?;
                    let issues: Vec<Value> = stmt.query_map([], |row| {
                        Ok(json!({
                            "id": row.get::<_, String>(0)?,
                            "project_id": id,
                            "title": row.get::<_, String>(1)?,
                            "culprit": row.get::<_, Option<String>>(2)?,
                            "status": row.get::<_, String>(3)?,
                            "count": row.get::<_, i32>(4)?,
                            "users_affected": row.get::<_, i32>(5)?,
                            "last_seen": row.get::<_, String>(6)?,
                            "is_suppressed": row.get::<_, i32>(7)? == 1,
                            "resolved_in_version": row.get::<_, Option<String>>(8)?,
                        }))
                    }).ok()?.filter_map(|r| r.ok()).collect();
                    all_issues.extend(issues);

                    macro_rules! agg {
                        ($dist:expr, $sql:expr) => {
                            if let Ok(mut s) = conn.prepare($sql) {
                                if let Ok(rows) = s.query_map([], |row| {
                                    Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
                                }) {
                                    for row in rows.filter_map(|r| r.ok()) {
                                        *$dist.entry(row.0).or_insert(0) += row.1;
                                    }
                                }
                            }
                        };
                    }
                    agg!(os_dist,      "SELECT os, COUNT(DISTINCT COALESCE(hwid, ip_address)) FROM events WHERE os IS NOT NULL GROUP BY os");
                    agg!(browser_dist, "SELECT browser, COUNT(DISTINCT COALESCE(hwid, ip_address)) FROM events WHERE browser IS NOT NULL GROUP BY browser");
                    agg!(region_dist,  "SELECT region, COUNT(DISTINCT COALESCE(hwid, ip_address)) FROM events WHERE region IS NOT NULL GROUP BY region");
                    
                    if let Ok(mut s) = conn.prepare("SELECT release_version, COUNT(*), SUM(is_error), COUNT(DISTINCT hwid) FROM sessions WHERE release_version IS NOT NULL GROUP BY release_version") {
                        if let Ok(rows) = s.query_map([], |row| {
                            Ok((
                                row.get::<_, String>(0)?, 
                                row.get::<_, i32>(1)?, 
                                row.get::<_, i32>(2)?, 
                                row.get::<_, i32>(3)?
                            ))
                        }) {
                            for row in rows.filter_map(|r| r.ok()) {
                                let key = format!("{}|{}", id, row.0);
                                let entry = release_dist.entry(key).or_insert(json!({ "total": 0, "errors": 0, "users": 0 }));
                                let total = entry["total"].as_i64().unwrap_or(0) + row.1 as i64;
                                let errors = entry["errors"].as_i64().unwrap_or(0) + row.2 as i64;
                                let users = entry["users"].as_i64().unwrap_or(0) + row.3 as i64;
                                *entry = json!({ "total": total, "errors": errors, "users": users });
                            }
                        }
                    }
                }
            }
        }

        let format_dist = |map: std::collections::HashMap<String, i32>| -> Vec<Value> {
            let mut v: Vec<_> = map.into_iter().map(|(k, v)| json!({ "name": k, "count": v })).collect();
            v.sort_by(|a, b| b["count"].as_i64().cmp(&a["count"].as_i64()));
            v
        };

        let mut releases_list = Vec::new();
        for (key, v) in release_dist {
            let parts: Vec<&str> = key.split('|').collect();
            if parts.len() == 2 {
                let pid = parts[0];
                let ver = parts[1];
                let total = v["total"].as_f64().unwrap_or(1.0).max(1.0);
                let errors = v["errors"].as_f64().unwrap_or(0.0);
                
                let pname = projects.iter()
                    .find(|proj| proj["id"].as_str() == Some(pid))
                    .and_then(|proj| proj["name"].as_str())
                    .unwrap_or(pid);

                releases_list.push(json!({
                    "project_id": pid,
                    "project_name": pname,
                    "version": ver,
                    "total_sessions": v["total"],
                    "error_sessions": v["errors"],
                    "unique_users": v["users"],
                    "stability": ((total - errors) / total * 100.0),
                    "adoption": 0,
                }));
            }
        }
        releases_list.sort_by(|a, b| b["total_sessions"].as_i64().cmp(&a["total_sessions"].as_i64()));

        Some(json!({
            "issues": all_issues,
            "total_events": all_issues.iter().map(|i| i["count"].as_i64().unwrap_or(0)).sum::<i64>(),
            "projects_count": projects.len(),
            "os_distribution": format_dist(os_dist),
            "browser_distribution": format_dist(browser_dist),
            "region_distribution": format_dist(region_dist),
            "releases": releases_list,
        }))
    }).await.unwrap_or(None);

    let value = result.unwrap_or_else(|| json!({ "issues": [], "total_events": 0, "projects_count": 0 }));

    if project_id != "all" {
        let cache = state.db_manager.get_project_cache(&project_id);
        cache.insert(cache_key, value.clone()).await;
    } else {
        state.db_manager.cache.insert(cache_key, value.clone()).await;
    }

    Ok(Json(value))
}
