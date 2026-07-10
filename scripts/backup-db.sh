#!/usr/bin/env bash
#
# JL-97 — Automated PostgreSQL backup for the ECM JIRA Clone.
#
# Runs pg_dump against DATABASE_URL, writes a timestamped gzip'd custom-format
# dump to the backup dir, and prunes dumps older than the retention window.
# Designed to be run from cron / a scheduled task.
#
# Env / config:
#   DATABASE_URL   PostgreSQL connection string (required)
#   BACKUP_DIR     output directory (default: ./backups)
#   RETENTION_DAYS delete backups older than N days (default: 14)
#
# Example (cron: daily at 02:30):
#   30 2 * * * DATABASE_URL=postgresql://user:pass@host:5432/jira_lite \
#     /path/to/scripts/backup-db.sh >> /var/log/ecm-jira-backup.log 2>&1
#
# Inside Docker Compose you can run it against the postgres service:
#   docker compose -f docker-compose.prod.yml exec -T postgres \
#     pg_dump -U jira_lite -Fc jira_lite > backups/manual.dump
#
# ── Restore ──────────────────────────────────────────────────────────────────
# Custom-format (.dump) files are restored with pg_restore:
#   gunzip -c backups/jira_lite-YYYYmmdd-HHMMSS.dump.gz > /tmp/restore.dump
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /tmp/restore.dump
# (Add --create and connect to the maintenance db if the target db must be
#  recreated first.)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "[backup-db] ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[backup-db] ERROR: pg_dump not found on PATH (install postgresql-client)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="$BACKUP_DIR/jira_lite-${timestamp}.dump.gz"

echo "[backup-db] Dumping database -> $outfile"
# -Fc = custom format (compressible, restorable with pg_restore).
pg_dump -Fc --no-owner "$DATABASE_URL" | gzip > "$outfile"

# Verify the file is non-empty.
if [[ ! -s "$outfile" ]]; then
  echo "[backup-db] ERROR: backup file is empty, removing." >&2
  rm -f "$outfile"
  exit 1
fi

size="$(du -h "$outfile" | cut -f1)"
echo "[backup-db] OK: $outfile ($size)"

# Retention: prune old dumps.
echo "[backup-db] Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -name 'jira_lite-*.dump.gz' -type f \
  -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[backup-db] Done."
