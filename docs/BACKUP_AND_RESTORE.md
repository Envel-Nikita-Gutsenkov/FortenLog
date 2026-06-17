# FortenLog Backup & Disaster Recovery Guide

This guide details how to perform automated, hot, and manual backups of the FortenLog SQLite analytics database, as well as the procedure to restore the database in case of disaster.

---

## 🏗️ Storage Architecture

FortenLog uses **SQLite** as its database engine. The active database files are located inside the container at:
* Core Database: `/app/data/fortenlog.db`
* Project Analytics Databases: `/app/data/fortenlog_<project_id>.db`

These files are persisted outside the container's volatile filesystem through a Docker Local Volume named `fortenlog_data`. In production deployments, this volume maps directly to your server's disk space (typically under `/var/lib/docker/volumes/deployment_fortenlog_data/_data/`).

---

## 🛡️ Backup Strategies

There are three ways to back up the FortenLog database:

### 1. Built-in Automated Backups (Application-Level)
FortenLog has a built-in automated maintenance loop. It performs database backups without taking the application offline using SQLite's native `VACUUM INTO` command.

* **Storage Path**: Backups are saved inside the container at `/app/data/backups/`.
* **Configuration**: Settings can be managed through the Admin UI or via the system settings database keys:
  * `auto_backup_enabled` (e.g., `true`)
  * `backup_schedule` (standard Cron expression)
  * `backup_retention_limit` (number of snapshots to keep)
* **REST API Endpoints**:
  * `POST /api/system/backup` — Trigger a system-wide hot-backup manually.
  * `GET /api/system/backups` — List available database backups.
  * `DELETE /api/system/backups/:filename` — Delete a specific backup file.

---

### 2. Automated Host-Level Backups (Cron Job)
To protect against host VPS failures, you should transfer backup files out of the Docker container environment onto the host filesystem (or subsequently sync them to offsite cloud storage).

We provide an automated script: **[`deployment/backup.sh`](file:///opt/fortenlog/deployment/backup.sh)**.

#### How it works:
1. Triggers a secure SQLite `VACUUM INTO` online hot-backup inside the running container.
2. Extracts the backup file to the host system directory `/var/backups/fortenlog/`.
3. Cleans up the temporary backup inside the container.
4. Compresses the backup using `gzip`.
5. Prunes backups on the host older than `14` days.

#### Installing the Cron Job:
To run the host-level backup automatically every day at 2:00 AM:

1. Copy `backup.sh` to your server and make it executable:
   ```bash
   chmod +x /home/fortenlog/deployment/backup.sh
   ```
2. Open the system crontab editor as root:
   ```bash
   sudo crontab -e
   ```
3. Append the following line:
   ```cron
   0 2 * * * /home/fortenlog/deployment/backup.sh >> /var/log/fortenlog_backup.log 2>&1
   ```

---

### 3. Manual Cold / Hot Backups (Console)
If you need to make an ad-hoc backup manually:

#### Secure Hot Backup (Safe for live databases)
Run this command on the server to execute a hot backup to the host's current directory:
```bash
docker exec -t fortenlog_app sqlite3 /app/data/fortenlog.db "VACUUM INTO '/app/data/backups/manual_temp.db'"
docker cp fortenlog_app:/app/data/backups/manual_temp.db ./manual_fortenlog_backup.db
docker exec -t fortenlog_app rm -f /app/data/backups/manual_temp.db
```

#### Cold Copy (Only if the container is stopped)
If the application is stopped, you can directly copy the database file from the Docker volume directory:
```bash
cp /var/lib/docker/volumes/deployment_fortenlog_data/_data/fortenlog.db ./fortenlog_cold_backup.db
```

---

## 🔄 Restore Procedure

To restore the system to a previous state, follow these steps:

### Method A: REST API Restore (Zero Downtime)
If the application is running, admins can restore via API or the Admin Panel:
```bash
curl -X POST -H "Authorization: Bearer <your_admin_token>" \
  https://fortenlog.example.com/api/system/backups/system_1718443200.db/restore
```
*Note: The application dynamically reloads database connections during restore to prevent transaction lockups.*

### Method B: Manual Restore (Disaster Recovery / Cold Restore)
If the database file is corrupted and the application cannot start, follow this procedure to restore from a `.db` or `.db.gz` file:

1. **Stop the environment**:
   ```bash
   docker compose -f /home/fortenlog/deployment/docker-compose.prod.yml down
   ```
2. **Locate your backup file** (e.g., `/var/backups/fortenlog/fortenlog_20260615_020000.db.gz`).
3. **Decompress the backup**:
   ```bash
   gzip -d -k /var/backups/fortenlog/fortenlog_20260615_020000.db.gz
   ```
4. **Overwrite the active database** in the Docker volume directory:
   ```bash
   sudo cp /var/backups/fortenlog/fortenlog_20260615_020000.db /var/lib/docker/volumes/deployment_fortenlog_data/_data/fortenlog.db
   ```
5. **Fix ownership and permissions**:
   ```bash
   sudo chown -R 65534:65534 /var/lib/docker/volumes/deployment_fortenlog_data/_data/fortenlog.db
   sudo chmod 644 /var/lib/docker/volumes/deployment_fortenlog_data/_data/fortenlog.db
   ```
   *(Note: UID `65534` is the default `nobody` user in Alpine, which runs the FortenLog binary).*
6. **Start the environment**:
   ```bash
   docker compose -f /home/fortenlog/deployment/docker-compose.prod.yml up -d
   ```
7. **Clean up decompressed files**:
   ```bash
   rm /var/backups/fortenlog/fortenlog_20260615_020000.db
   ```
