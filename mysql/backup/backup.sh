#!/bin/sh
# Logical MySQL backup -> R2. Run as a scheduled Fly machine in the blogwai-mysql app.
# rclone reads the "r2" remote from RCLONE_CONFIG_R2_* env vars (set as Fly secrets/env).
set -eu

: "${MYSQL_HOST:=blogwai-mysql.internal}"
: "${MYSQL_PORT:=3306}"
: "${MYSQL_USER:=ghost}"
: "${MYSQL_DATABASE:=ghost_prod}"
: "${RETAIN_DAYS:=30}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/${MYSQL_DATABASE}-${TS}.sql.gz"

echo "[backup] dumping ${MYSQL_DATABASE} @ ${MYSQL_HOST}:${MYSQL_PORT} -> r2:${BACKUP_BUCKET}/mysql/"
mysqldump --single-transaction --quick --no-tablespaces --skip-lock-tables \
  -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" \
  "$MYSQL_DATABASE" | gzip -9 > "$OUT"
echo "[backup] dump size: $(du -h "$OUT" | cut -f1)"

rclone copyto "$OUT" "r2:${BACKUP_BUCKET}/mysql/${MYSQL_DATABASE}-${TS}.sql.gz"
echo "[backup] uploaded ${MYSQL_DATABASE}-${TS}.sql.gz"

# Prune backups older than RETAIN_DAYS.
rclone delete --min-age "${RETAIN_DAYS}d" "r2:${BACKUP_BUCKET}/mysql/" 2>/dev/null || true
echo "[backup] done (retain ${RETAIN_DAYS}d)"
