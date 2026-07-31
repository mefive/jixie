#!/usr/bin/env bash
# Validate an existing market-data baseline once, initialize its publication watermark when needed,
# and enable the production maintenance timers.
set -Eeuo pipefail

PROJECT_DIR="${JIXIE_DIR:-/opt/jixie}"
SERVICE="${JIXIE_SERVICE:-jixie-api}"
DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
DATABASE_FILE="$DATA_DIR/prod.db"
LOCK_FILE="$DATA_DIR/maintenance.lock"
API_WAS_ACTIVE=0
API_STOPPED=0

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

restore_api() {
  local exit_code=$?

  trap - EXIT INT TERM
  if [[ "$API_STOPPED" == "1" && "$API_WAS_ACTIVE" == "1" ]]; then
    sudo systemctl start "$SERVICE" || true
  fi
  exit "$exit_code"
}

trap restore_api EXIT INT TERM

for command in flock pnpm sqlite3 sudo systemctl; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is missing: $command"
done
[[ -d "$PROJECT_DIR" && -f "$PROJECT_DIR/package.json" ]] ||
  die "Invalid jixie project directory: $PROJECT_DIR"
[[ -r "$PROJECT_DIR/apps/api/.env" ]] ||
  die "apps/api/.env is missing; run bootstrap.sh first"
[[ -f "$DATABASE_FILE" ]] || die "Production database is missing: $DATABASE_FILE"
SYSTEMD_PAGER=cat systemctl cat "$SERVICE" >/dev/null 2>&1 ||
  die "systemd service does not exist: $SERVICE"

cd "$PROJECT_DIR"
sudo -v

daily_rows="$(sqlite3 "$DATABASE_FILE" 'SELECT COUNT(*) FROM "Daily";')"
[[ "$daily_rows" -gt 0 ]] || die "Daily is empty; complete pnpm import:data first"
watermark="$(
  sqlite3 "$DATABASE_FILE" \
    "SELECT dailyPublishedThrough FROM MaintenanceState WHERE key = 'global';" 2>/dev/null ||
    true
)"

log "Pause maintenance timers while activation holds the shared lock"
sudo systemctl stop jixie-maintenance.timer jixie-maintenance-weekly.timer
exec 9>>"$LOCK_FILE"
flock -n -E 75 9 || die "Another maintenance process is running"

if [[ -z "$watermark" ]]; then
  log "Initialize the validated publication watermark"
  if systemctl is-active --quiet "$SERVICE"; then
    API_WAS_ACTIVE=1
    sudo systemctl stop "$SERVICE"
    API_STOPPED=1
  fi
  JIXIE_MAINTENANCE_LOCK_HELD=1 pnpm --filter api maintenance:init
else
  log "Publication watermark already exists: $watermark"
fi

sudo systemctl start "$SERVICE"
API_STOPPED=0

flock -u 9
log "Enable production maintenance timers"
sudo systemctl enable --now \
  jixie-maintenance.timer \
  jixie-maintenance-weekly.timer

systemctl list-timers 'jixie-*' --no-pager
log "Maintenance activation complete"
