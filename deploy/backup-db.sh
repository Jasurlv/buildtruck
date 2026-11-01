#!/usr/bin/env bash
# Dump the Buildtruck database to /var/backups/buildtruck and prune old dumps.
# Runs as the postgres user from buildtruck-db-backup.service.
set -euo pipefail

DB_NAME="${DB_NAME:-timetrack_db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/buildtruck}"
KEEP_DAYS="${KEEP_DAYS:-14}"

umask 077
mkdir -p "$BACKUP_DIR"

target="$BACKUP_DIR/${DB_NAME}_$(date -u +%Y%m%dT%H%M%SZ).dump"
# Write to a temporary name so a failed dump never looks like a good backup.
pg_dump --format=custom --no-owner --dbname="$DB_NAME" --file="$target.partial"
mv "$target.partial" "$target"

find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name "*.partial" -mmin +60 -delete

echo "Backup written to $target ($(du -h "$target" | cut -f1))"
