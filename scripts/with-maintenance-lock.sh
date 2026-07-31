#!/usr/bin/env bash
# Run an internal command under the shared production maintenance lock.
set -Eeuo pipefail

PROJECT_DIR="${JIXIE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_ENV_FILE="$PROJECT_DIR/apps/api/.env"
DATA_DIR="${JIXIE_DATA_DIR:-}"

[[ "$#" -gt 0 ]] || {
  echo "Usage: with-maintenance-lock.sh COMMAND [ARG...]" >&2
  exit 2
}

cd "$PROJECT_DIR"

if [[ -z "$DATA_DIR" && -f "$API_ENV_FILE" ]] && command -v node >/dev/null 2>&1; then
  database_url="$(
    node --env-file="$API_ENV_FILE" \
      -e 'process.stdout.write(process.env.DATABASE_URL ?? "")'
  )"
  if [[ "$database_url" == file:/* ]]; then
    DATA_DIR="$(dirname "${database_url#file:}")"
  fi
fi
DATA_DIR="${DATA_DIR:-/var/lib/jixie}"
LOCK_FILE="${JIXIE_MAINTENANCE_LOCK_FILE:-$DATA_DIR/maintenance.lock}"

if [[ "${JIXIE_MAINTENANCE_LOCK_HELD:-0}" == "1" ]]; then
  exec "$@"
fi

is_production=0
if [[ "${NODE_ENV:-}" == "production" ]] ||
  { [[ -f "$API_ENV_FILE" ]] && grep -Eq '^NODE_ENV="?production"?$' "$API_ENV_FILE"; }; then
  is_production=1
fi

if [[ "$is_production" == "0" ]]; then
  exec "$@"
fi

command -v flock >/dev/null 2>&1 || {
  echo "Production maintenance requires flock" >&2
  exit 1
}
[[ -d "$DATA_DIR" ]] || {
  echo "Production data directory does not exist: $DATA_DIR" >&2
  exit 1
}

exec flock -n -E 75 "$LOCK_FILE" env JIXIE_MAINTENANCE_LOCK_HELD=1 "$@"
