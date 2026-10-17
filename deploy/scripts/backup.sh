#!/usr/bin/env bash
# Encrypted LexiChat backup.
#
# The backup zip is streamed from the container directly into `age` - no
# unencrypted copy is written to the host. Only the PUBLIC age recipient(s)
# are needed on the server; the private key is stored offline / separately.
#
#   BACKUP_DIR=/srv/lexichat-backups AGE_RECIPIENTS=/etc/lexichat/age-recipients.txt ./scripts/backup.sh
#
# Example cron (daily 02:15): 15 2 * * * cd /opt/lexichat/deploy && ./scripts/backup.sh >>/var/log/lexichat-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/srv/lexichat-backups}"
AGE_RECIPIENTS="${AGE_RECIPIENTS:-/etc/lexichat/age-recipients.txt}"
KEEP_DAYS="${KEEP_DAYS:-30}"

command -v age >/dev/null || { echo "age ist nicht installiert (apt install age)" >&2; exit 1; }
[[ -s "$AGE_RECIPIENTS" ]] || { echo "Empfängerdatei $AGE_RECIPIENTS fehlt" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/lexichat-$ts.zip.age"
tmp="$out.partial"

docker compose exec -T server /app/lexichat backup-stream --dir /pb_data \
  | age --encrypt -R "$AGE_RECIPIENTS" -o "$tmp"
mv "$tmp" "$out"
sha256sum "$out" > "$out.sha256"
echo "$(date -Is) Backup erstellt: $out ($(du -h "$out" | cut -f1))"

# retention (must match the deletion concept, docs/datenschutz/05-loeschkonzept.md)
find "$BACKUP_DIR" -name 'lexichat-*.zip.age*' -type f -mtime +"$KEEP_DAYS" -print -delete
