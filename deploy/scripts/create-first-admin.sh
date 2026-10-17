#!/usr/bin/env bash
# Creates the first LexiChat admin account inside the running server container.
# The one-time password is printed ONCE to this terminal (never logged) and
# must be changed at the first login.
#
#   ./scripts/create-first-admin.sh <username> "<Anzeigename>"
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -ne 2 ]]; then
  echo "Aufruf: $0 <benutzername> \"<Anzeigename>\"" >&2
  exit 1
fi

# -T is NOT used so that the output goes to the interactive terminal only
docker compose exec server /app/lexichat bootstrap-admin --dir /pb_data --username "$1" --name "$2"

cat <<'TXT'
Optional: PocketBase-Superuser (Notfallzugang zum Dashboard via SSH-Tunnel) anlegen:
  docker compose exec server /app/lexichat superuser upsert <email> <passwort> --dir /pb_data
Das Passwort danach sicher (Passwortmanager/Tresor) hinterlegen und die Shell-History bereinigen.
TXT
