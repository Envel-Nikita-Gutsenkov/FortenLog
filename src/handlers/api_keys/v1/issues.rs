use axum::{extract::State, Json, http::StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::handlers::ingest::AppState;
use crate::middleware::api_key::ApiKeyClaims;
use super::{require_scope, check_project_access, clamp_limit};

#[derive(Debug, Deserialize)]
pub struct IssueListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub status: Option<String>,
    pub q: Option<String>,
    pub sort: Option<String>,
}

/// GET /v1/projects/:project_id/issues
pub async fn v1_list_issues(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path(project_id): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<IssueListParams>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "issues:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let limit = clamp_limit(params.limit);
    let offset = params.offset.unwrap_or(0).max(0);
    let status_filter = params.status.clone();
    let q_filter = params.q.clone();
    let sort_col = match params.sort.as_deref() {
        Some("count") => "count",
        Some("first_seen") => "first_seen",
        Some("users_affected") => "users_affected",
        _ => "last_seen",
    };

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut where_clauses = Vec::new();
        let mut sql_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref st) = status_filter {
            where_clauses.push("status = ?");
            sql_params.push(Box::new(st.clone()));
        }
        if let Some(ref q) = q_filter {
            where_clauses.push("(title LIKE ? OR culprit LIKE ?)");
            let pattern = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
            sql_params.push(Box::new(pattern.clone()));
            sql_params.push(Box::new(pattern));
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let count_sql = format!("SELECT COUNT(*) FROM issues {}", where_sql);
        let params_refs: Vec<&dyn rusqlite::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();
        let total: i64 = conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0)).unwrap_or(0);

        let list_sql = format!(
            "SELECT id, title, culprit, status, count, users_affected, first_seen, last_seen, is_suppressed, resolved_in_version
             FROM issues {} ORDER BY {} DESC LIMIT ? OFFSET ?",
            where_sql, sort_col
        );
        let mut all_params: Vec<Box<dyn rusqlite::ToSql>> = sql_params;
        all_params.push(Box::new(limit));
        all_params.push(Box::new(offset));
        let params_refs2: Vec<&dyn rusqlite::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&list_sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let issues: Vec<Value> = stmt
            .query_map(params_refs2.as_slice(), |row| {
                Ok(json!({
                    "id":                  row.get::<_, String>(0)?,
                    "title":               row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    "culprit":             row.get::<_, Option<String>>(2)?,
                    "status":              row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "unhandled".into()),
                    "count":               row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    "users_affected":      row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                    "first_seen":          row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    "last_seen":           row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    "is_suppressed":       row.get::<_, Option<i32>>(8)?.unwrap_or(0) == 1,
                    "resolved_in_version": row.get::<_, Option<String>>(9)?,
                    "project_id":          project_id.clone(),
                }))
            })
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten()
            .collect();

        Ok::<_, StatusCode>(json!({ "total": total, "limit": limit, "offset": offset, "items": issues }))
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}

/// GET /v1/projects/:project_id/issues/:issue_id
pub async fn v1_get_issue(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<ApiKeyClaims>,
    axum::extract::Path((project_id, issue_id)): axum::extract::Path<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    require_scope(&claims, "issues:read")?;
    check_project_access(state.db_manager.clone(), &claims, project_id.clone()).await?;

    let pool = state.db_manager.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        conn.query_row(
            "SELECT id, title, culprit, status, count, users_affected, first_seen, last_seen, is_suppressed, resolved_in_version
             FROM issues WHERE id = ?1",
            [&issue_id],
            |row| Ok(json!({
                "id":                  row.get::<_, String>(0)?,
                "title":               row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "culprit":             row.get::<_, Option<String>>(2)?,
                "status":              row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "unhandled".into()),
                "count":               row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                "users_affected":      row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                "first_seen":          row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                "last_seen":           row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                "is_suppressed":       row.get::<_, Option<i32>>(8)?.unwrap_or(0) == 1,
                "resolved_in_version": row.get::<_, Option<String>>(9)?,
                "project_id":          project_id.clone(),
            })),
        )
        .map_err(|_| StatusCode::NOT_FOUND)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(result))
}
