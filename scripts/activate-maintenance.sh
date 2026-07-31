#!/usr/bin/env bash
# Run the daily coordinator once to establish or advance the publication watermark, then enable the
# production maintenance timers.
set -Eeuo pipefail

PROJECT_DIR="${JIXIE_DIR:-/opt/jixie}"
SERVICE="${JIXIE_SERVICE:-jixie-api}"
DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
DATABASE_FILE="$DATA_DIR/prod.db"

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

for command in sqlite3 sudo systemctl; do
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
log "Pause scheduled attempts during activation"
sudo systemctl stop jixie-maintenance.timer jixie-maintenance-weekly.timer

sudo systemctl start "$SERVICE"
watermark="$(
  sqlite3 "$DATABASE_FILE" \
    "SELECT dailyPublishedThrough FROM MaintenanceState WHERE key = 'global';" 2>/dev/null ||
    true
)"
if [[ -z "$watermark" ]]; then
  log "Run the daily coordinator to establish the publication watermark"
  sudo systemctl start jixie-maintenance.service
  watermark="$(
    sqlite3 "$DATABASE_FILE" \
      "SELECT dailyPublishedThrough FROM MaintenanceState WHERE key = 'global';" 2>/dev/null ||
      true
  )"
else
  log "Publication watermark already exists: $watermark"
fi
[[ -n "$watermark" ]] || die "Daily maintenance finished without a publication watermark"

log "Enable production maintenance timers"
sudo systemctl enable --now \
  jixie-maintenance.timer \
  jixie-maintenance-weekly.timer

systemctl list-timers 'jixie-*' --no-pager
log "Maintenance activation complete"
