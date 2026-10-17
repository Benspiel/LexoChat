#!/usr/bin/env bash
# Restores an encrypted LexiChat backup into the pb_data volume.
# DANGER: replaces the current data. The old volume content is kept as a copy.
#
#   ./scripts/restore.sh /pfad/lexichat-<ts>.zip.age /pfad/age-identity.txt
#
# Afterwards: verify the audit chain and do a test login (see docs/betriebshandbuch.md).
set -euo pipefail
cd "$(dirname "$0")/.."

[[ $# -eq 2 ]] || { echo "Aufruf: $0 <backup.zip.age> <age-identity-datei>" >&2; exit 1; }
backup="$(realpath "$1")"; identity="$(realpath "$2")"
[[ -f "$backup" && -f "$identity" ]] || { echo "Datei nicht gefunden" >&2; exit 1; }
if [[ -f "$backup.sha256" ]]; then
  (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup").sha256")
fi

read -r -p "Aktuelle Daten werden ersetzt. Fortfahren? (ja/nein) " answer
[[ "$answer" == "ja" ]] || exit 1

AGE_RECIPIENTS="${AGE_RECIPIENTS:-/etc/lexichat/age-recipients.txt}"
[[ -s "$AGE_RECIPIENTS" ]] || { echo "Empfängerdatei $AGE_RECIPIENTS fehlt (für die Sicherung des aktuellen Stands)" >&2; exit 1; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age --decrypt -i "$identity" -o "$work/backup.zip" "$backup"

project="$(docker compose config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')"
volume="${project}_pb_data"
helper="alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8"

docker compose stop server
# keep an (encrypted) copy of the current state
docker run --rm -v "$volume":/pb_data -v "$work":/work "$helper" \
  sh -c 'cd /pb_data && tar czf /work/pre-restore.tgz . 2>/dev/null || true'
age --encrypt -R "$AGE_RECIPIENTS" -o "./pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz.age" "$work/pre-restore.tgz"

docker run --rm -v "$volume":/pb_data -v "$work":/work "$helper" sh -euc '
  find /pb_data -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} +
  cd /pb_data && unzip -q /work/backup.zip
  chown -R 65532:65532 /pb_data
'

docker compose start server
docker compose exec server /app/lexichat verify-audit --dir /pb_data
echo "Wiederherstellung abgeschlossen. Bitte Test-Anmeldung durchführen und im Betriebshandbuch protokollieren."
echo "Der vorherige Stand liegt verschlüsselt in ./pre-restore-*.tgz.age."
