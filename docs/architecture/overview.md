# FortenLog System Architecture: A Deep Dive

This document is the definitive guide to the internal architecture, engineering approaches, and structural paradigms of FortenLog. It explains the "why" and "how" behind our technological choices, aimed at software engineers, devops professionals, and system architects.

---

## 1. Architectural Philosophy

The modern observability landscape is dominated by complex distributed systems (e.g., Kafka -> Logstash -> Elasticsearch). While these architectures scale infinitely, they introduce catastrophic overhead: JVM garbage collection pauses, network boundary serialization latency, and staggering RAM requirements.

FortenLog was built on a radically different philosophy: **Monolithic Efficiency via Vertical Scaling.**
By eliminating network boundaries between the API, the queue, and the storage engine, FortenLog achieves throughput matching multi-server clusters on a single standard VPS. It is fundamentally engineered to be **up to 100x more performant and economical** than operating standard Sentry or PostHog microservice architectures, while seamlessly accepting data from their native SDKs.

### Technology Stack
- **Backend Core**: Asynchronous Rust (`tokio`, `axum`). Chosen for memory safety without garbage collection, ensuring perfectly predictable P99 latencies under maximum load.
- **Storage Layer**: Embedded SQLite (`rusqlite`, `r2d2`). Used in an isolated, multi-tenant Write-Ahead Logging (WAL) configuration.
- **In-Memory Caching**: `moka`. A highly concurrent cache inspired by Java's Caffeine, used for rate limiting and spam deduplication.
- **Frontend**: Vanilla ECMAScript 6, HTML5, CSS3. We intentionally rejected heavyweight SPA frameworks (React/Vue) to ensure the client-side dashboard renders instantaneously and the entire application can be compiled into a single static binary via `rust_embed`.

---

## 2. The Asynchronous Ingestion Engine

The ingestion pipeline is the bottleneck of any telemetry system. If the ingestion API blocks waiting for a disk write, the entire system collapses under spike loads.

### 2.1 The Tokio MPSC Buffer Pattern
When a client SDK (like Sentry or PostHog) sends an HTTP POST request, FortenLog does **not** write to the database. 

Instead, the Axum HTTP handler serializes the JSON payload and pushes it into a `tokio::sync::mpsc::channel`.
```rust
// Inside the Axum Handler
let event = TelemetryEvent::parse(payload);
let _ = state.ingest_tx.send(event).await; 
return Ok(StatusCode::OK); // Client receives 200 OK instantly
```
This channel is initialized with a massive capacity (default `50,000`). If a newly deployed bug causes your frontend to fire 10,000 exceptions per second, the channel absorbs the spike entirely in RAM, preventing the HTTP layer from locking up.

### 2.2 The Batch Processing Worker
A dedicated background asynchronous task (`ingestion_worker`) continuously monitors the receiving end of the channel. It employs a dynamic batching algorithm using `try_recv`:

### 2.2 Async Batch Worker
A background worker (`ingestion_worker`) continuously drains this channel.
- **Transaction Batching**: Instead of executing 500 individual `INSERT` commands, the worker dequeues up to 500 events and writes them inside a **single, unified SQLite transaction**.
- **The Result**: We collapse 500 disk I/O operations into 1 file-system commit. This fundamentally bypasses SQLite's concurrency limitations, allowing FortenLog to ingest **tens of thousands of requests per second** on standard SSDs.

### 2.3 Real-World Resource Scaling
Because of the complete removal of network boundaries (no separate database server, no Redis, no Kafka) and the zero-cost abstractions of Rust, the resource footprint is staggeringly low.

It is designed to run flawlessly even on low-end virtual machines:
* 🟢 **Idle State:** Negligible system footprint, requiring minimal background CPU cycles and RAM.
* 🟡 **Sustained Traffic:** Thanks to batching, disk write commits are minimal compared to incoming requests, keeping CPU and memory overhead extremely light.
* 🔴 **Massive Spikes:** The Tokio MPSC buffer dynamically absorbs sudden bursts, keeping memory consumption safe and bounded without risk of OOM crashes, while API response latency remains sub-millisecond.

---

## 3. Storage Architecture: Multi-Tenant SQLite

Dumping heterogeneous telemetry from multiple projects into a single PostgreSQL database creates a "noisy neighbor" problem. A heavy analytical query on Project A's data will thrash the buffer pool and slow down Project B's ingestion.

### 3.1 Strict Physical Isolation
FortenLog uses a **Multi-Tenant SQLite** architecture. 
- `system.db`: Stores global configurations, user credentials, and uptime monitors.
- `projects/project_id.db`: Every project gets its own isolated `.db` file. 

Pools are managed dynamically via `r2d2` and cached in a thread-safe `DashMap`. If a project is deleted, the file is simply unlinked from the filesystem—no expensive `DELETE FROM ... WHERE project_id = ?` queries required.

### 3.2 Industrial PRAGMA Tuning
SQLite is often mistakenly viewed as a "toy" database. When configured correctly, it outperforms traditional RDBMS for local workloads. We apply the following `PRAGMA` hooks on every connection:

- **`journal_mode=WAL`**: Write-Ahead Logging allows simultaneous, non-blocking reads and writes.
- **`synchronous=NORMAL`**: Relies on the WAL checkpoint for data integrity rather than syncing every transaction. Safe, and 10x faster.
- **`mmap_size=268435456`**: Maps up to 256MB of the database directly into the RAM address space. The OS page cache handles reads natively, bypassing the kernel context switch overhead entirely. Dashboard analytical queries are subsequently executed at memory speeds.
- **`temp_store=MEMORY`**: Forces SQLite to use RAM for temporary indices and sorting operations (e.g., complex `GROUP BY` dashboard queries), saving NVMe wear.

---

## 4. Deduplication & Storage Policies

A primary pain point for developers is runaway disk usage. Telemetry databases often bloat to hundreds of gigabytes, crashing the host server.

FortenLog solves this natively through application-layer data engineering.

### 4.1 Zstd Payload Compression
Sentry crash dumps often contain massive stack traces and deep contextual variables. Before touching the disk, FortenLog compresses the raw JSON payload using the `zstd` algorithm.
```rust
// Zstd compression before DB insertion
let compressed = zstd::stream::encode_all(raw_json.as_bytes(), 3)?;
```
This reduces the raw storage footprint by 60-80% immediately.

### 4.2 PostHog Analytics Rollups
To retain analytical data forever without infinite disk growth, FortenLog performs intelligent deduplication.
When an event arrives, volatile fields (like random distinct IDs or timestamps) are stripped. The remaining JSON structure is hashed (SHA-256). Identical structures are aggregated into a daily bucket:

```sql
INSERT INTO analytics_rollups (event_name, properties_hash, count, date_bucket)
VALUES (?, ?, 1, ?)
ON CONFLICT DO UPDATE SET count = count + 1;
```
If a user clicks a "Buy" button 10,000 times in a day, FortenLog stores **1 row** with a `count = 10000`, rather than 10,000 rows.

### 4.3 14-Day GDPR Data Pruning
The `storage_policy_worker` runs continuously in the background. It sweeps the `events` and `payloads` tables, permanently deleting raw records that are older than 14 days. 
Because long-term statistical trends are preserved in the `analytics_rollups` table, you maintain accurate "Daily Active Users" and "Click Conversions" for years, while legally and safely purging sensitive IP addresses and user agents.

---

## 5. Security Architecture

### 5.1 CSRF & Integration Exemptions
Administrative dashboard routes are heavily guarded by CSRF tokenization (enforced via a custom `X-FortenLog-Request` header). 
However, public ingestion endpoints (`/capture/`, `/api/*/envelope/`) are explicitly bypassed in the Axum middleware. This architectural choice guarantees that third-party SDKs (which cannot easily send custom headers) work flawlessly as drop-in replacements.

### 5.2 Moka Rate Limiting
Public endpoints are protected by tiered in-memory `Moka` caches:
- **IP Rate Limit**: Limits sudden bursts from abusive clients (e.g., 1000 requests per minute).
- **Spam Deduplication**: The `user_spam_cache` records the combination of a Crash Fingerprint and a Hardware ID. If a broken client sends the same exception in an infinite loop, FortenLog detects the cache hit, drops the raw payload, and merely increments the issue `count`.

### 5.3 Stealth Authentication
When "Stealth Mode" is enabled, the backend intercepts all unauthorized access attempts and returns a uniform `404 Not Found` rather than `401 Unauthorized`. This prevents automated scanners and botnets from identifying the presence of the FortenLog portal, neutralizing credential brute-forcing entirely.

---

## 6. Mitigating Architectural Bottlenecks

While FortenLog is heavily optimized, operating at 10,000+ RPS pushes single-node architecture to its physical limits. We explicitly address the three most common bottlenecks:

### 6.1 WAL File Bloat (Checkpoints)
At 10,000 RPS (20 massive batch commits per second), SQLite writes heavily to the `-wal` file. If the background checkpoint process cannot keep up with the write velocity, the WAL file can bloat to gigabytes, slowing down reads.
**Mitigation:** We tune `PRAGMA wal_autocheckpoint=2000;`. This forces SQLite to passively move WAL data into the main database file in small, frequent ~16MB chunks rather than letting it grow uncontrollably.

### 6.2 SQLITE_BUSY During Heavy Analytics
While WAL allows simultaneous readers and writers, when SQLite performs a background `CHECKPOINT`, it can momentarily acquire an exclusive lock. If a user runs a heavy custom dashboard query at that exact millisecond, SQLite natively throws a `SQLITE_BUSY` error.
**Mitigation:** We strictly enforce `PRAGMA busy_timeout=5000;` on all connection pools. If a checkpoint locks the database, analytical read queries gracefully pause and wait for up to 5 seconds instead of failing, completely neutralizing `SQLITE_BUSY` exceptions.

### 6.3 High Availability & SPOF (Single Point of Failure)
FortenLog trades distributed consensus (like Kafka/Elasticsearch clusters) for phenomenal single-node speed. The downside is that if the physical NVMe drive dies, the data is lost.
**Mitigation:** Telemetry data is inherently ephemeral. For disaster recovery, we recommend:
1. Using provider-level Block Storage Snapshots (e.g., AWS EBS or DigitalOcean Volumes).
2. Utilizing the built-in FortenLog `/api/system/backups` endpoints to stream encrypted SQLite copies to cold storage (S3) via daily Cron jobs.

---

## Conclusion
FortenLog is not just a script writing JSON to a database. It is a highly engineered, deeply optimized, multi-tenant time-series engine. By deeply understanding and exploiting the boundaries between asynchronous Rust, memory-mapped I/O, and SQLite WAL mechanics, it achieves a rare balance: industrial scale performance with the operational simplicity of a single binary.
