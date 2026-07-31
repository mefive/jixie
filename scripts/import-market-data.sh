#!/usr/bin/env bash
# Import the complete production research dataset from Tushare into an empty jixie database.
#
# Usage:
#   pnpm import:data
#   pnpm import:data 20150101 20260729
#
# Long-running VPS example:
#   nohup pnpm import:data > /var/lib/jixie/full-import.log 2>&1 &
#
# The import is split into restartable stages. Successful stages leave markers under
# .jixie-import/<start>-<end>; rerunning the same range skips them. Set
# JIXIE_IMPORT_IGNORE_STATE=1 to run every stage again. The underlying sync commands are idempotent.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEFAULT_END="$(
  node -e "const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map((part)=>[part.type,part.value]));const prior=new Date(Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)-1));process.stdout.write(prior.toISOString().slice(0,10).replaceAll('-',''))"
)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

START_DATE="${1:-${JIXIE_IMPORT_START:-20150101}}"
END_DATE="${2:-${JIXIE_IMPORT_END:-$DEFAULT_END}}"
STATE_ROOT="${JIXIE_IMPORT_STATE_DIR:-$PROJECT_DIR/.jixie-import}"
STATE_DIR="$STATE_ROOT/$START_DATE-$END_DATE"
IGNORE_STATE="${JIXIE_IMPORT_IGNORE_STATE:-0}"
DRY_RUN="${JIXIE_IMPORT_DRY_RUN:-0}"

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

warn() {
  printf '[warn] %s\n' "$*" >&2
}

validate_date() {
  [[ "$1" =~ ^[0-9]{8}$ ]] || die "Invalid date '$1'; expected YYYYMMDD"
}

run_stage() {
  local key="$1"
  local label="$2"
  shift 2
  local marker="$STATE_DIR/$key.done"

  if [[ "$IGNORE_STATE" != "1" && -f "$marker" ]]; then
    log "Skip completed stage: $label"
    return 0
  fi

  log "$label"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  CURRENT_STAGE="$label"
  "$@"
  printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"$marker"
}

validate_date "$START_DATE"
validate_date "$END_DATE"
[[ "$START_DATE" -le "$END_DATE" ]] || die "Start date must not exceed end date"
command -v node >/dev/null 2>&1 || die "node is required"
command -v pnpm >/dev/null 2>&1 || die "pnpm is required"
[[ -f "$PROJECT_DIR/apps/api/.env" ]] || die "apps/api/.env is missing; run bootstrap.sh first"

cd "$PROJECT_DIR"
mkdir -p "$STATE_DIR"

if command -v systemctl >/dev/null 2>&1 &&
  systemctl is-active --quiet "${JIXIE_SERVICE:-jixie-api}"; then
  warn "${JIXIE_SERVICE:-jixie-api} is running; stop it during the initial import to avoid scheduler contention"
fi

CURRENT_STAGE="preflight"
trap 'printf "\n[error] Import failed during: %s\nRerun the same command to resume.\n" "$CURRENT_STAGE" >&2' ERR

log "Full market-data import"
printf '    Range: %s ~ %s\n' "$START_DATE" "$END_DATE"
printf '    State: %s\n' "$STATE_DIR"
printf '    Mode:  %s\n' "$([[ "$DRY_RUN" == "1" ]] && printf dry-run || printf import)"

run_stage migrations "Apply production database migrations" \
  pnpm --filter api exec prisma migrate deploy
run_stage tushare-smoke "Verify Tushare connectivity" pnpm --filter api smoke
run_stage stock-history "Import complete stock metadata and historical names" \
  pnpm --filter api sync:stock-history 19900101 "$END_DATE"

START_YEAR=$((10#${START_DATE:0:4}))
END_YEAR=$((10#${END_DATE:0:4}))
for ((year = START_YEAR; year <= END_YEAR; year++)); do
  slice_start="${year}0101"
  slice_end="${year}1231"
  [[ "$slice_start" -lt "$START_DATE" ]] && slice_start="$START_DATE"
  [[ "$slice_end" -gt "$END_DATE" ]] && slice_end="$END_DATE"

  run_stage "stock-bars-$year" "Import A-share bars and adjustment factors: $slice_start ~ $slice_end" \
    pnpm --filter api sync "$slice_start" "$slice_end"
  run_stage "daily-basic-$year" "Import daily valuation and turnover: $slice_start ~ $slice_end" \
    pnpm --filter api sync:basic "$slice_start" "$slice_end"
  run_stage "price-limits-$year" "Import daily price limits: $slice_start ~ $slice_end" \
    pnpm --filter api sync:limit "$slice_start" "$slice_end"
  run_stage "moneyflow-$year" "Import daily money flow: $slice_start ~ $slice_end" \
    pnpm --filter api sync:moneyflow "$slice_start" "$slice_end"
  run_stage "top-list-$year" "Import Dragon-Tiger List data: $slice_start ~ $slice_end" \
    pnpm --filter api sync:toplist "$slice_start" "$slice_end"
done

run_stage financials "Import complete financial indicators and dividend history" \
  pnpm --filter api sync:fina
run_stage sw-industry "Import point-in-time Shenwan industry membership" \
  pnpm --filter api sync:sw-industry
run_stage etf "Import metadata and daily history for the major ETF preset" \
  pnpm --filter api sync:etf "$START_DATE" "$END_DATE" major
run_stage index-daily "Import complete daily history for the major index preset" \
  pnpm --filter api sync:index-daily 19900101 "$END_DATE" major
run_stage index-basic "Import available valuation history for the major index preset" \
  pnpm --filter api sync:index-basic 20040101 "$END_DATE" major
run_stage index-membership "Import point-in-time constituents for market-state indices" \
  pnpm --filter api sync:index market-state "$START_DATE" "$END_DATE"
run_stage futures "Import stock-index futures contracts, bars, mappings, and settlements" \
  pnpm --filter api sync:futures "$START_DATE" "$END_DATE"
run_stage canonicalize-stock-codes "Canonicalize superseded stock codes" \
  pnpm --filter api canonicalize:stock-codes
run_stage baseline-self-heal "Repair deterministic gaps near the initial publication baseline" \
  pnpm --filter api maintenance:heal-baseline "$END_DATE"
run_stage market-state "Precompute whole-market, index, and industry state" \
  pnpm --filter api sync:market-state "$START_DATE" "$END_DATE"
run_stage audit "Run the read-only full data-quality audit" \
  pnpm audit:data "$START_DATE" "$END_DATE" --strict
log "Full market-data import completed"
printf '    Range: %s ~ %s\n' "$START_DATE" "$END_DATE"
printf '    Resume markers: %s\n' "$STATE_DIR"
