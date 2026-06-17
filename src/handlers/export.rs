use axum::{
    extract::{State, Query},
    http::{header, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

#[derive(Deserialize)]
pub struct ExportParams {
    pub project_id: Option<String>,
}

struct ReceiverStream {
    rx: tokio::sync::mpsc::Receiver<Result<axum::body::Bytes, std::io::Error>>,
}

impl futures_util::stream::Stream for ReceiverStream {
    type Item = Result<axum::body::Bytes, std::io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

pub async fn export_csv(
    State(state): State<Arc<AppState>>,
    axum::Extension(claims): axum::Extension<Claims>,
    Query(params): Query<ExportParams>,
) -> Result<impl IntoResponse, StatusCode> {
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let db = Arc::clone(&state.db_manager);

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);

    // 1. Spawn blocking DB task
    tokio::task::spawn_blocking(move || {
        let projects = if let Some(pid) = params.project_id {
            if pid == "all" {
                if let Ok(conn) = db.get_system_conn() {
                    let mut stmt = match conn.prepare("SELECT id FROM projects") {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!("Database prepare error in export_csv projects: {:?}", e);
                            return;
                        }
                    };
                    stmt.query_map([], |row| row.get::<_, String>(0)).unwrap().filter_map(|r| r.ok()).collect()
                } else { vec![] }
            } else {
                vec![pid]
            }
        } else {
            vec![]
        };

        // Write header
        if tx.blocking_send(Ok(axum::body::Bytes::from("id,timestamp,event_type,os,browser,region,release_version,ip_address,project_id\n"))).is_err() {
            return;
        }

        for pid in projects {
            if let Ok(pool) = db.get_project_pool(&pid) {
                if let Ok(conn) = pool.get() {
                    if let Ok(mut stmt) = conn.prepare(
                        "SELECT id, timestamp, event_type, os, browser, region, release_version, ip_address \
                         FROM events \
                         ORDER BY timestamp DESC LIMIT 5000"
                    ) {
                        let rows = stmt.query_map([], |row| {
                            Ok(format!("{},{},{},{},{},{},{},{},{}\n",
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                                pid.clone()
                            ))
                        });

                        if let Ok(rows) = rows {
                            for row in rows.filter_map(|r| r.ok()) {
                                if tx.blocking_send(Ok(axum::body::Bytes::from(row))).is_err() {
                                    return; // receiver dropped
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    let body = axum::body::Body::from_stream(ReceiverStream { rx });

    let headers = [
        (header::CONTENT_TYPE, "text/csv"),
        (header::CONTENT_DISPOSITION, "attachment; filename=\"fortenlog_export.csv\""),
    ];

    Ok((StatusCode::OK, headers, body))
}
