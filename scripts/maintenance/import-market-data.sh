#!/usr/bin/env bash
# 在一个隔离候选中导入，阶段断点由候选库持久化。
# Import into one isolated candidate with durable per-stage checkpoints.
set -Eeuo pipefail

PROJECT_DIR="${JIXIE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  printf 'Usage: pnpm import:data [START END]\nDefaults: 20150101 through yesterday in Asia/Shanghai. Rerun the same range to resume.\n'
  exit 0
fi
[[ "$#" -le 2 ]] || { printf 'Usage: pnpm import:data [START END]\n' >&2; exit 2; }
DEFAULT_END="$(node -e 'const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const date=new Date(`${today}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-1);process.stdout.write(date.toISOString().slice(0,10).replaceAll("-",""))')"
START_DATE="${1:-${JIXIE_IMPORT_START:-20150101}}"
END_DATE="${2:-${JIXIE_IMPORT_END:-$DEFAULT_END}}"
[[ "$START_DATE" =~ ^[0-9]{8}$ && "$END_DATE" =~ ^[0-9]{8}$ && "$START_DATE" -le "$END_DATE" ]] || { printf 'Invalid import range\n' >&2; exit 2; }
cd "$PROJECT_DIR"
if [[ "${JIXIE_IMPORT_DRY_RUN:-0}" == '1' ]]; then
  printf 'maintenance import %s %s (one candidate, one publication)\n' "$START_DATE" "$END_DATE"
  exit 0
fi
# bootstrap 直接启动 Node 才能保留经校验的实际锁 FD，pnpm 子进程不会传递它们。
# Bootstrap starts Node directly to preserve verified lock descriptors across exec.
if [[ -n "${JIXIE_MAINTENANCE_LOCK_FD:-}" ]]; then
  exec node --env-file="$PROJECT_DIR/apps/api/.env" "$PROJECT_DIR/apps/api/dist/src/maintenance/cli/run-maintenance.js" import "$START_DATE" "$END_DATE"
fi
exec pnpm --filter api maintenance import "$START_DATE" "$END_DATE"
