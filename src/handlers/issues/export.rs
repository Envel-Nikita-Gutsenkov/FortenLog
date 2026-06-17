use axum::{
    extract::{State, Path as AxumPath, Query},
    http::{header, StatusCode},
    response::IntoResponse,
};
use std::sync::Arc;
use crate::handlers::ingest::AppState;
use crate::handlers::auth::Claims;

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

// GET /api/projects/:project_id/issues/:id/export
pub async fn export_issue_data(
    State(state): State<Arc<AppState>>,
    axum::Extension(_claims): axum::Extension<Claims>,
    AxumPath((project_id, issue_id)): AxumPath<(String, String)>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    let format = params.get("format").cloned().unwrap_or_else(|| "json".to_string());
    let db = Arc::clone(&state.db_manager);

    let pool = db.get_project_pool(&project_id).map_err(|_| StatusCode::NOT_FOUND)?;

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);

    let iid = issue_id.clone();
    let format_clone = format.clone();

    // 1. Spawn blocking DB worker
    tokio::task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, timestamp, event_type, os, browser, region, payload_hash \
                 FROM events \
                 WHERE issue_id = ?"
            ) {
                let rows = stmt.query_map([&iid], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        row.get::<_, String>(6)?,
                    ))
                });

                if let Ok(rows) = rows {
                    if format_clone == "csv" {
                        // Stream CSV header
                        if tx.blocking_send(Ok(axum::body::Bytes::from("ID,Timestamp,Type,OS,Browser,Region,PayloadHash\n"))).is_err() {
                            return;
                        }

                        for r in rows.filter_map(|r| r.ok()) {
                            let csv_row = format!("{},{},{},{},{},{},{}\n",
                                r.0, r.1, r.2, r.3, r.4, r.5, r.6
                            );
                            if tx.blocking_send(Ok(axum::body::Bytes::from(csv_row))).is_err() {
                                return; // receiver dropped
                            }
                        }
                    } else {
                        // Stream JSON Array chunk-by-chunk
                        if tx.blocking_send(Ok(axum::body::Bytes::from("[\n"))).is_err() {
                            return;
                        }

                        let mut first = true;
                        for r in rows.filter_map(|r| r.ok()) {
                            let comma = if first { first = false; "" } else { ",\n" };
                            let json_chunk = format!("{}{{\"id\":\"{}\",\"timestamp\":\"{}\",\"event_type\":\"{}\",\"os\":\"{}\",\"browser\":\"{}\",\"region\":\"{}\",\"payload_hash\":\"{}\"}}",
                                comma, r.0, r.1, r.2, r.3, r.4, r.5, r.6
                            );
                            if tx.blocking_send(Ok(axum::body::Bytes::from(json_chunk))).is_err() {
                                return; // receiver dropped
                            }
                        }

                        let _ = tx.blocking_send(Ok(axum::body::Bytes::from("\n]")));
                    }
                }
            }
        }
    });

    let body = axum::body::Body::from_stream(ReceiverStream { rx });

    if format == "csv" {
        let headers = [
            (header::CONTENT_TYPE, "text/csv".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"issue_{}.csv\"", issue_id)),
        ];
        Ok((StatusCode::OK, headers, body))
    } else {
        let headers = [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"issue_{}.json\"", issue_id)),
        ];
        Ok((StatusCode::OK, headers, body))
    }
}
