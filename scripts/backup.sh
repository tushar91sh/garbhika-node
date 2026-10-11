#!/usr/bin/env bash
# Usage: MONGODB_URI="..." ./scripts/backup.sh [output-dir]
# Writes a compressed dump of the database. Requires MongoDB Database Tools (mongodump) on PATH.
set -euo pipefail
OUT="${1:-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
mongodump --uri="$MONGODB_URI" --gzip --out="$OUT"
echo "Backup written to $OUT"
# Keep the 14 most recent backups.
ls -1dt "${1:-backups}"/*/ 2>/dev/null | tail -n +15 | xargs -r rm -rf
