#!/bin/bash
# ===================================================================
# 🛡️ FORTENLOG AUTOMATED SECURE HOT-BACKUP SCRIPT
# ===================================================================
# This script performs a safe SQLite online hot-backup (using VACUUM INTO)
# inside the Docker container, extracts the backup to the host machine,
# and prunes backups older than the configured retention period.
#
# Best used as a cron job (e.g. daily at 2:00 AM).
# ===================================================================

# --- CONFIGURATION ---
CONTAINER_NAME="fortenlog_app"
BACKUP_DIR="/var/backups/fortenlog"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_DB_NAME="hot_backup_${TIMESTAMP}.db"
HOST_BACKUP_PATH="${BACKUP_DIR}/fortenlog_${TIMESTAMP}.db"

# ANSI Color Codes for status output (omitted if not running in TTY)
if [ -t 1 ]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    BLUE='\033[0;34m'
    NC='\033[0;37m'
else
    GREEN=''
    YELLOW=''
    RED=''
    BLUE=''
    NC=''
fi

echo -e "${BLUE}[INFO] Starting FortenLog Backup Process...${NC}"

# 1. Create backup directory on host if it does not exist
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}[WARN] Host backup directory ${BACKUP_DIR} does not exist. Creating it...${NC}"
    sudo mkdir -p "$BACKUP_DIR"
    sudo chmod 750 "$BACKUP_DIR"
fi

# 2. Check if the FortenLog container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}[ERROR] Container ${CONTAINER_NAME} is not running! Cannot perform hot-backup.${NC}"
    exit 1
fi

# 3. Perform SQLite online hot-backup inside the container
# This uses SQLite's 'VACUUM INTO' which ensures database integrity 
# and doesn't block active write transactions.
echo -e "${BLUE}[INFO] Performing SQLite hot-backup inside container...${NC}"
docker exec -t "$CONTAINER_NAME" sqlite3 /app/data/fortenlog.db "VACUUM INTO '/app/data/backups/${TEMP_DB_NAME}';"
if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Internal SQLite backup failed!${NC}"
    exit 1
fi

# 4. Copy the backup file from the container to the host
echo -e "${BLUE}[INFO] Extracting backup to host: ${HOST_BACKUP_PATH}...${NC}"
docker cp "${CONTAINER_NAME}:/app/data/backups/${TEMP_DB_NAME}" "$HOST_BACKUP_PATH"
if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Failed to copy backup from container to host!${NC}"
    # Clean up container file anyway
    docker exec -t "$CONTAINER_NAME" rm -f "/app/data/backups/${TEMP_DB_NAME}"
    exit 1
fi

# 5. Clean up the temporary file inside the container
docker exec -t "$CONTAINER_NAME" rm -f "/app/data/backups/${TEMP_DB_NAME}"

# 6. Set correct permissions for the host backup file
sudo chmod 640 "$HOST_BACKUP_PATH"

# 7. Compress backup (optional but highly recommended for text/analytics DBs)
echo -e "${BLUE}[INFO] Compressing backup file...${NC}"
sudo gzip -f "$HOST_BACKUP_PATH"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS] Backup saved: ${HOST_BACKUP_PATH}.gz${NC}"
else
    echo -e "${YELLOW}[WARN] Compression failed, backup kept in raw format.${NC}"
fi

# 8. Prune backups older than RETENTION_DAYS
echo -e "${BLUE}[INFO] Cleaning up backups older than ${RETENTION_DAYS} days...${NC}"
sudo find "$BACKUP_DIR" -name "fortenlog_*.db.gz" -type f -mtime +"$RETENTION_DAYS" -delete
sudo find "$BACKUP_DIR" -name "fortenlog_*.db" -type f -mtime +"$RETENTION_DAYS" -delete

echo -e "${GREEN}[SUCCESS] Backup process completed successfully!${NC}"
