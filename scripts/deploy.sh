#!/usr/bin/env bash
# Redeploy jixie. Run ON the VPS from /opt/jixie. First-time provisioning (clone, systemd, nginx,
# certbot, .env.production, DB seed) is the one-off scripts/bootstrap.sh.
#
# Usage:
#   ./scripts/deploy.sh          # full deployment (backward-compatible default)
#   ./scripts/deploy.sh all      # full deployment
#   ./scripts/deploy.sh api      # shared + API, migrations, service restart
#   ./scripts/deploy.sh web      # shared + web only
#   ./scripts/deploy.sh docs     # shared + public docs only
set -Eeuo pipefail

DIR="${JIXIE_DIR:-/opt/jixie}"
SERVICE="${JIXIE_SERVICE:-jixie-api}"
DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
BACKUP_DIR="${JIXIE_BACKUP_DIR:-/var/backups/jixie}"
TARGET="${1:-all}"
LOCK_FILE="${JIXIE_DEPLOY_LOCK_FILE:-/tmp/jixie-deploy.lock}"
LOCK_DIR="$(dirname -- "$LOCK_FILE")"
NODE_HEAP_OPTIONS="--max-old-space-size=4096"
STAGING_DIR=""
ACTIVE_LIVE_DIR=""
ACTIVE_PREVIOUS_DIR=""

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM
  if [[ -n "$ACTIVE_LIVE_DIR" && ! -e "$ACTIVE_LIVE_DIR" && -e "$ACTIVE_PREVIOUS_DIR" ]]; then
    mv -- "$ACTIVE_PREVIOUS_DIR" "$ACTIVE_LIVE_DIR" || true
  fi
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi

  exit "$exit_code"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"
}

recover_interrupted_activation() {
  local live_dir="$1"
  local previous_dir="$live_dir.deploy-previous"

  if [[ ! -e "$live_dir" && -e "$previous_dir" ]]; then
    log "Recover interrupted activation: $live_dir"
    mv -- "$previous_dir" "$live_dir"
  elif [[ -e "$live_dir" && -e "$previous_dir" ]]; then
    rm -rf -- "$previous_dir"
  fi
}

activate_static_build() {
  local live_dir="$1"
  local staging_dir="$2"
  local previous_dir="$live_dir.deploy-previous"

  [[ -f "$staging_dir/index.html" ]] || die "Static build is incomplete: $staging_dir/index.html"
  mkdir -p -- "$(dirname -- "$live_dir")"
  recover_interrupted_activation "$live_dir"

  ACTIVE_LIVE_DIR="$live_dir"
  ACTIVE_PREVIOUS_DIR="$previous_dir"
  if [[ -e "$live_dir" ]]; then
    mv -- "$live_dir" "$previous_dir"
  fi
  mv -- "$staging_dir" "$live_dir"
  STAGING_DIR=""

  if [[ -e "$previous_dir" ]]; then
    rm -rf -- "$previous_dir"
  fi
  ACTIVE_LIVE_DIR=""
  ACTIVE_PREVIOUS_DIR=""
}

build_static_app() {
  local package_name="$1"
  local app_dir="$2"
  local live_dir="$3"

  STAGING_DIR="$(mktemp -d "$app_dir/.deploy-dist.XXXXXX")"
  log "Typecheck + build $package_name in staging"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter "$package_name" exec tsc --noEmit
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter "$package_name" exec vite build \
    --outDir "$STAGING_DIR" \
    --emptyOutDir

  # mktemp creates the staging root with mode 0700. The directory becomes the live Nginx document
  # root after activation, so make the public static tree readable and traversable first.
  chmod -R a+rX "$STAGING_DIR"

  log "Activate $package_name"
  activate_static_build "$live_dir" "$STAGING_DIR"
}

if [[ "$TARGET" == "-h" || "$TARGET" == "--help" ]]; then
  usage
  exit 0
fi
[[ "$#" -le 1 ]] || die "Expected one deployment target; see --help"
case "$TARGET" in
  all | api | web | docs) ;;
  *) die "Unknown deployment target '$TARGET'; expected all, api, web, or docs" ;;
esac

trap cleanup EXIT INT TERM

require_command git
require_command node
require_command pnpm
require_command flock
[[ -d "$DIR" ]] || die "Deployment directory does not exist: $DIR"

cd "$DIR"
PROJECT_DIR="$(pwd -P)"
[[ -f package.json && -f pnpm-lock.yaml && -f pnpm-workspace.yaml ]] ||
  die "Deployment directory is not a pnpm workspace: $PROJECT_DIR"
[[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$PROJECT_DIR" ]] ||
  die "Deployment directory is not the Git worktree root: $PROJECT_DIR"
git symbolic-ref --quiet HEAD >/dev/null ||
  die "Detached HEAD is not deployable; check out the production branch first"
git rev-parse --verify '@{upstream}' >/dev/null 2>&1 ||
  die "Current branch has no upstream; configure it before deploying"
git diff --quiet && git diff --cached --quiet ||
  die "Tracked changes exist in the deployment worktree; commit or restore them first"
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)" ||
  die "Node.js >=22.13 is required"

if [[ "$TARGET" == "api" || "$TARGET" == "all" ]]; then
  require_command sudo
  require_command systemctl
  [[ -f apps/api/package.json ]] || die "API workspace is missing: apps/api/package.json"
  [[ -r apps/api/.env ]] || die "apps/api/.env is missing or unreadable; run bootstrap.sh first"
  SYSTEMD_PAGER=cat systemctl cat "$SERVICE" >/dev/null 2>&1 ||
    die "systemd service does not exist: $SERVICE"
  sudo -v
fi

if [[ "$TARGET" == "web" || "$TARGET" == "all" ]]; then
  [[ -f apps/web/package.json && -w apps/web ]] ||
    die "Web workspace is missing or not writable: apps/web"
fi

if [[ "$TARGET" == "docs" || "$TARGET" == "all" ]]; then
  [[ -f apps/docs/package.json && -w apps/docs ]] ||
    die "Docs workspace is missing or not writable: apps/docs"
fi

if [[ "$TARGET" == "all" ]]; then
  [[ -f deploy/nginx-jixie.conf && -f deploy/nginx-docs-app.conf ]] ||
    die "Nginx deployment configuration is incomplete"
  sudo nginx -t >/dev/null || die "Current Nginx configuration is invalid"
fi

[[ -d "$LOCK_DIR" && -w "$LOCK_DIR" ]] ||
  die "Deployment lock directory is missing or not writable: $LOCK_DIR"
exec 9>>"$LOCK_FILE"
flock -n 9 || die "Another jixie deployment is already running"

log "git pull --ff-only"
git pull --ff-only

log "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

log "Build @jixie/shared"
NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter @jixie/shared build

if [[ "$TARGET" == "api" || "$TARGET" == "all" ]]; then
  log "Build API"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter api build

  log "prisma migrate deploy"
  pnpm --filter api exec prisma migrate deploy

  log "Install maintenance and backup systemd units"
  DEPLOY_USER="$(systemctl show "$SERVICE" -p User --value)"
  [[ -n "$DEPLOY_USER" ]] || die "Could not resolve the API service user"
  sudo mkdir -p "$DATA_DIR" "$BACKUP_DIR"
  sudo chown "$DEPLOY_USER:$DEPLOY_USER" "$DATA_DIR" "$BACKUP_DIR"
  for unit in \
    jixie-maintenance.service \
    jixie-maintenance.timer \
    jixie-maintenance-weekly.service \
    jixie-maintenance-weekly.timer \
    jixie-backup.service \
    jixie-backup.timer; do
    sed -e "s#/opt/jixie#$PROJECT_DIR#g" \
        -e "s#/var/lib/jixie#$DATA_DIR#g" \
        -e "s#/var/backups/jixie#$BACKUP_DIR#g" \
        -e "s#jixie-api.service#$SERVICE.service#g" \
        -e "s#^User=jixie#User=$DEPLOY_USER#" \
        -e "s#^Group=jixie#Group=$DEPLOY_USER#" \
        "deploy/$unit" | sudo tee "/etc/systemd/system/$unit" >/dev/null
  done
  sudo systemctl daemon-reload
  sudo systemd-analyze verify \
    jixie-maintenance.service \
    jixie-maintenance.timer \
    jixie-maintenance-weekly.service \
    jixie-maintenance-weekly.timer \
    jixie-backup.service \
    jixie-backup.timer
  sudo systemctl enable --now \
    jixie-maintenance.timer \
    jixie-maintenance-weekly.timer \
    jixie-backup.timer
fi

if [[ "$TARGET" == "web" || "$TARGET" == "all" ]]; then
  build_static_app web "$PROJECT_DIR/apps/web" "$PROJECT_DIR/apps/web/dist"
fi

if [[ "$TARGET" == "docs" || "$TARGET" == "all" ]]; then
  build_static_app docs "$PROJECT_DIR/apps/docs" "$PROJECT_DIR/apps/docs/dist/docs"
fi

if [[ "$TARGET" == "all" ]]; then
  log "Validate + reload nginx"
  sudo nginx -t
  sudo systemctl reload nginx
fi

if [[ "$TARGET" == "api" || "$TARGET" == "all" ]]; then
  log "Restart $SERVICE"
  sudo systemctl restart "$SERVICE"

  sleep 1
  systemctl is-active --quiet "$SERVICE" ||
    die "$SERVICE is not running; inspect logs with: journalctl -u $SERVICE -e"
fi

log "Deployed target '$TARGET' @ $(git rev-parse --short HEAD)"
