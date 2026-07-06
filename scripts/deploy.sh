#!/usr/bin/env bash
# Redeploy jixie. Run ON the VPS from /opt/jixie. First-time provisioning (clone, systemd, nginx,
# certbot, .env.production, DB seed) is the one-off scripts/bootstrap.sh — this is routine "pull & restart".
set -euo pipefail

DIR="${JIXIE_DIR:-/opt/jixie}"
SERVICE="${JIXIE_SERVICE:-jixie-api}"
cd "$DIR"

echo "==> git pull"
git pull --ff-only

echo "==> pnpm install (also builds @jixie/shared via its prepare script)"
pnpm install --frozen-lockfile

echo "==> prisma migrate deploy (applies any new migrations to the prod DB)"
pnpm --filter api exec prisma migrate deploy

echo "==> build shared + api + web (topo order)"
pnpm -r build

echo "==> restart $SERVICE"
sudo systemctl restart "$SERVICE"

sleep 1
if systemctl is-active --quiet "$SERVICE"; then
  echo "==> deployed @ $(git rev-parse --short HEAD)"
else
  echo "!! $SERVICE 未运行,查日志: journalctl -u $SERVICE -e" >&2
  exit 1
fi
