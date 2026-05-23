#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME="${DB_NAME:-dataplatform}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/outputs/pg_backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
PRUNE="${1:-}"

mkdir -p "$BACKUP_DIR"

TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"

echo "[backup] db=$DB_NAME user=$DB_USER -> $OUT"

# Dump from the postgres container (pg_dump is included in postgres:16 image)
docker exec -e PGPASSWORD="$DB_PASSWORD" dataplatform-pg-dashboard \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl \
  | gzip > "$OUT"

ls -lh "$OUT"

echo "[backup] backups in $BACKUP_DIR (top 20):"
ls -lht "$BACKUP_DIR" | head -n 20

if [ "$PRUNE" = "--prune" ]; then
  echo "[backup] pruning backups older than $RETENTION_DAYS days"
  find "$BACKUP_DIR" -type f -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete
else
  echo "[backup] dry-run prune list (pass --prune to delete):"
  find "$BACKUP_DIR" -type f -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -print
fi
