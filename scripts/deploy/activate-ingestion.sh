#!/usr/bin/env bash
# 启用统一同步；空库和来源缺口不阻塞服务启动。
# Enable unified synchronization; empty data and source gaps never block application startup.
set -Eeuo pipefail

PROJECT_DIR="${JIXIE_DIR:-/opt/jixie}"
SERVICE="${JIXIE_SERVICE:-jixie-api}"

[[ -f "$PROJECT_DIR/apps/api/dist/src/ingestion/cli/data.js" ]] || {
  printf '[error] Build the API before activating synchronization\n' >&2
  exit 1
}
sudo systemctl disable --now jixie-maintenance.timer jixie-maintenance-weekly.timer 2>/dev/null || true
sudo systemctl start "$SERVICE"
sudo systemctl enable --now jixie-ingestion.timer
systemctl list-timers 'jixie-*' --no-pager
