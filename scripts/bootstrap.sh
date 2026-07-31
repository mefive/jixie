#!/usr/bin/env bash
# jixie 一键部署 —— 新机器安装缺失资源，已有机器安全更新，幂等可重复跑。
#
#   ssh 登录后:  cd /opt/jixie && ./scripts/bootstrap.sh
#   (首次机器上还没有代码时,先把这个脚本单独 scp 上去跑,它会自己 clone。)
#
# 幂等:已装依赖不重装、已有代码 pull 不重 clone、已存在的 .env.production 不覆盖(只 upsert 注入的密钥)、
# 已被 certbot 改写的 HTTPS vhost 不覆盖、默认邀请码只在新库首次生成、空库全量导入可断点续传。
set -euo pipefail

# ─────────────────────────────── 配置(env var 覆盖) ───────────────────────────────
JIXIE_REPO="${JIXIE_REPO:-https://github.com/mefive/jixie.git}"
JIXIE_BRANCH="${JIXIE_BRANCH:-main}"
JIXIE_DIR="${JIXIE_DIR:-/opt/jixie}"
JIXIE_DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
JIXIE_BACKUP_DIR="${JIXIE_BACKUP_DIR:-/var/backups/jixie}"
JIXIE_BOOTSTRAP_LOCK_FILE="${JIXIE_BOOTSTRAP_LOCK_FILE:-/tmp/jixie-bootstrap.lock}"
JIXIE_PORT="${JIXIE_PORT:-3001}"
JIXIE_DOMAIN="${JIXIE_DOMAIN:-jixie.example.com}"
JIXIE_SERVICE="${JIXIE_SERVICE:-jixie-api}"
JIXIE_DEPLOY_USER="${JIXIE_DEPLOY_USER:-$(id -un)}"   # 跑服务的系统用户,默认当前登录用户
JIXIE_TLS="${JIXIE_TLS:-auto}"                        # auto = 尝试 certbot 签证书; skip = 只起 80
JIXIE_TLS_EMAIL="${JIXIE_TLS_EMAIL:-}"                # certbot 注册邮箱(机器已有 LE 账号可留空)
JIXIE_INVITES_EXPLICIT=0
[[ -n "${JIXIE_INVITES+x}" ]] && JIXIE_INVITES_EXPLICIT=1
JIXIE_INVITES="${JIXIE_INVITES:-1}"                   # 首批邀请码数量,0 = 不生成

# 可选密钥注入(留空则保留 .env.production 现状 / example 默认值)
TUSHARE_TOKEN="${TUSHARE_TOKEN:-}"
RESEND_API_KEY="${RESEND_API_KEY:-}"
EMAIL_FROM="${EMAIL_FROM:-}"
DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"

# ─────────────────────────────── 工具函数 ───────────────────────────────
log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[err] %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

nginx_vhost_has_tls() {
  local file="$1"
  [[ -f "$file" ]] && sudo grep -Eq 'listen[[:space:]].*443|ssl_certificate' "$file"
}

# 在 KEY=VALUE 文件里 upsert 一行(存在则替换,不存在则追加)。值用 "" 包裹。空值跳过(不清除现有)。
set_env_var() {
  local file="$1" key="$2" val="$3"
  [[ -z "$val" ]] && return 0
  touch "$file"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    KEY="$key" VAL="$val" perl -i -pe 's/^\s*\Q$ENV{KEY}\E=.*/$ENV{KEY}="$ENV{VAL}"/ if /^\s*\Q$ENV{KEY}\E=/' "$file"
  else
    printf '%s="%s"\n' "$key" "$val" >>"$file"
  fi
}

# ─────────────────────────────── 0. 前置检查 ───────────────────────────────
[[ "$(id -u)" -eq 0 ]] && die "请以普通 sudo 用户(如 ubuntu)运行,而非 root —— 服务以非 root 身份运行。"
sudo -n true 2>/dev/null || sudo true || die "当前用户需要 sudo 权限。"

# 包管理器:Ubuntu/Debian = apt,CentOS/RHEL = dnf/yum。
if have apt-get; then
  PKG=apt
elif have dnf; then
  PKG=dnf
elif have yum; then
  PKG=yum
else
  die "未找到 apt/dnf/yum —— 仅支持 Ubuntu/Debian 或 CentOS/RHEL。"
fi

log "目标配置"
cat <<EOF
  代码目录   : $JIXIE_DIR  (来自 $JIXIE_REPO @ $JIXIE_BRANCH)
  数据目录   : $JIXIE_DATA_DIR  (prod.db 落这里,不在 git 内)
  域名/端口  : $JIXIE_DOMAIN  ->  127.0.0.1:$JIXIE_PORT
  systemd    : $JIXIE_SERVICE  (User=$JIXIE_DEPLOY_USER)
  TLS        : $JIXIE_TLS
  包管理器   : $PKG
EOF

# ─────────────────────────────── 1. 系统依赖 ───────────────────────────────
log "检查/安装系统依赖"
pkg_install() {
  if [[ "$PKG" == apt ]]; then
    sudo apt-get update -y
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  else
    sudo "$PKG" install -y "$@"
  fi
}
PKGS=()
have git     || PKGS+=(git)
have curl    || PKGS+=(curl)
have rsync   || PKGS+=(rsync)
have flock   || PKGS+=(util-linux)
have nginx   || PKGS+=(nginx)
have sqlite3 || PKGS+=(sqlite3)     # backup 脚本(scripts/backup-db.mjs)依赖 sqlite3 CLI
# isolated-vm(硬沙箱)是原生模块,pnpm install 时需要 C++ 工具链编译
if [[ "$PKG" == apt ]]; then
  have g++ || PKGS+=(build-essential python3)
else
  have g++ || PKGS+=(gcc-c++ make python3)
fi
# certbot + 其 nginx 插件(两发行版包名一致:python3-certbot-nginx)
have certbot || PKGS+=(certbot python3-certbot-nginx)
if ((${#PKGS[@]})); then
  log "安装: ${PKGS[*]}"
  pkg_install "${PKGS[@]}"
fi

# Node 22+:缺失或主版本 <22 则走 NodeSource 装 22.x
# (node:sqlite 的只读 SQL worker 需要 ≥22.13;Node 20 已于 2026-04 EOL)
NODE_OK=0
if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$NODE_MAJOR" -ge 22 ]] && NODE_OK=1
fi
if [[ "$NODE_OK" -ne 1 ]]; then
  log "安装 Node.js 22.x (NodeSource)"
  if [[ "$PKG" == apt ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    pkg_install nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
    pkg_install nodejs
  fi
fi

# pnpm:优先 corepack(随 node 自带)
if ! have pnpm; then
  log "通过 corepack 启用 pnpm"
  sudo corepack enable || true
  corepack prepare pnpm@latest --activate || sudo npm i -g pnpm
fi
log "运行时: node $(node -v) / pnpm $(pnpm -v) / sqlite3 $(sqlite3 --version | awk '{print $1}')"

if [[ "${JIXIE_BOOTSTRAP_LOCK_HELD:-0}" != "1" ]]; then
  exec 8>>"$JIXIE_BOOTSTRAP_LOCK_FILE"
  flock -n 8 || die "另一个 bootstrap 正在运行"
  export JIXIE_BOOTSTRAP_LOCK_HELD=1
fi

# ─────────────────────────────── 2. 拉代码 ───────────────────────────────
if [[ -d "$JIXIE_DIR/.git" ]]; then
  log "代码已存在,git pull --ff-only"
  git -C "$JIXIE_DIR" diff --quiet &&
    git -C "$JIXIE_DIR" diff --cached --quiet ||
    die "部署目录存在未提交的 tracked 修改,请先提交或恢复"
  PREVIOUS_REVISION="$(git -C "$JIXIE_DIR" rev-parse HEAD)"
  git -C "$JIXIE_DIR" fetch origin "$JIXIE_BRANCH"
  git -C "$JIXIE_DIR" checkout "$JIXIE_BRANCH"
  git -C "$JIXIE_DIR" pull --ff-only
else
  PREVIOUS_REVISION=""
  log "首次 clone 到 $JIXIE_DIR"
  sudo mkdir -p "$JIXIE_DIR"
  sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" "$JIXIE_DIR"
  git clone --branch "$JIXIE_BRANCH" "$JIXIE_REPO" "$JIXIE_DIR" \
    || die "git clone 失败 —— 私有仓库需在本机配 GitHub 访问凭据(SSH key / deploy token)。"
fi
cd "$JIXIE_DIR"
CURRENT_REVISION="$(git rev-parse HEAD)"
if [[ "${JIXIE_BOOTSTRAP_REEXEC:-0}" != "1" && "$CURRENT_REVISION" != "$PREVIOUS_REVISION" ]]; then
  log "使用刚拉取的新版本 bootstrap 继续"
  exec env JIXIE_BOOTSTRAP_REEXEC=1 "$JIXIE_DIR/scripts/bootstrap.sh"
fi

# ─────────────────────────────── 3. 数据目录(DB 落在代码目录外) ───────────────────────────────
log "准备数据目录 $JIXIE_DATA_DIR"
sudo mkdir -p "$JIXIE_DATA_DIR"
sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" "$JIXIE_DATA_DIR"
sudo mkdir -p "$JIXIE_BACKUP_DIR"
sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" "$JIXIE_BACKUP_DIR"
DB_FILE="$JIXIE_DATA_DIR/prod.db"
exec 9>>"$JIXIE_DATA_DIR/maintenance.lock"
flock -n -E 75 9 || die "maintenance 正在运行,本次 bootstrap 不与其并发"
export JIXIE_MAINTENANCE_LOCK_HELD=1

# ─────────────────────────────── 4. 环境变量 ───────────────────────────────
log "配置 .env.production"
ENV_PROD="$JIXIE_DIR/apps/api/.env.production"
if [[ ! -f "$ENV_PROD" ]]; then
  cp "$JIXIE_DIR/apps/api/.env.production.example" "$ENV_PROD"
  echo "  已从 example 生成 $ENV_PROD"
else
  echo "  $ENV_PROD 已存在,保留(仅 upsert 注入的密钥)"
fi
set_env_var "$ENV_PROD" DATABASE_URL "file:$JIXIE_DATA_DIR/prod.db"
set_env_var "$ENV_PROD" PORT "$JIXIE_PORT"
set_env_var "$ENV_PROD" NODE_ENV "production"
set_env_var "$ENV_PROD" TUSHARE_TOKEN "$TUSHARE_TOKEN"
set_env_var "$ENV_PROD" RESEND_API_KEY "$RESEND_API_KEY"
set_env_var "$ENV_PROD" EMAIL_FROM "$EMAIL_FROM"
set_env_var "$ENV_PROD" DEEPSEEK_API_KEY "$DEEPSEEK_API_KEY"
chmod 600 "$ENV_PROD"

# prisma CLI / gen:invite / sync 脚本读 .env,软链到 .env.production(运行时由 systemd 经 EnvironmentFile 注入)
ln -sf .env.production "$JIXIE_DIR/apps/api/.env"

# 密钥缺失提醒(不致命,但影响功能)
grep -qE '^TUSHARE_TOKEN=""?$'   "$ENV_PROD" 2>/dev/null && warn "TUSHARE_TOKEN 为空 —— app 无法启动、也无法同步行情!必须填。"
grep -qE '^RESEND_API_KEY=""?$'  "$ENV_PROD" 2>/dev/null && warn "RESEND_API_KEY 为空 —— 生产无 console 兜底,没人能登录。"
grep -qE '^DEEPSEEK_API_KEY=""?$' "$ENV_PROD" 2>/dev/null && warn "DEEPSEEK_API_KEY 为空 —— NL→代码 / Agent 不可用(其余功能正常)。"

# ─────────────────────────────── 5. 安装 / 迁移 / 构建 ───────────────────────────────
log "pnpm install --frozen-lockfile (顺带经 @jixie/shared 的 prepare 构建 shared)"
pnpm install --frozen-lockfile

log "prisma generate + migrate deploy (建库 schema 于 $DB_FILE)"
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate deploy

log "pnpm -r build (拓扑序: shared -> api -> web; Node heap 4GB)"
# ⚠ 内存:vite build + 回测都偏吃内存。<2GB 的 VPS 建议配 swap,或本机构建后 rsync apps/web/dist。
NODE_OPTIONS="--max-old-space-size=4096" pnpm -r build

IMPORT_REQUIRED_MARKER="$JIXIE_DATA_DIR/full-import.required"
DAILY_ROWS="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "Daily";' 2>/dev/null || echo 0)"
if [[ "${DAILY_ROWS:-0}" -eq 0 ]]; then
  touch "$IMPORT_REQUIRED_MARKER"
fi
if [[ -f "$IMPORT_REQUIRED_MARKER" ]]; then
  log "行情库尚未完成初始化,执行可断点续传的全量导入"
  if systemctl is-active --quiet "$JIXIE_SERVICE" 2>/dev/null; then
    sudo systemctl stop "$JIXIE_SERVICE"
  fi
  pnpm import:data
  rm -f "$IMPORT_REQUIRED_MARKER"
fi

INVITE_COUNT="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "InviteCode";' 2>/dev/null || echo 0)"
if [[ "$JIXIE_INVITES_EXPLICIT" -ne 1 && "${INVITE_COUNT:-0}" -gt 0 ]]; then
  log "邀请码已存在,跳过默认邀请码生成(如需补发,显式设 JIXIE_INVITES=N)"
elif [[ "$JIXIE_INVITES" -gt 0 ]]; then
  log "生成 $JIXIE_INVITES 个邀请码"
  pnpm --filter api gen:invite "$JIXIE_INVITES" "bootstrap" || warn "gen:invite 失败,可稍后手动补。"
fi

# ─────────────────────────────── 6. systemd 服务 ───────────────────────────────
log "安装 systemd 服务 $JIXIE_SERVICE"
UNIT_DST="/etc/systemd/system/$JIXIE_SERVICE.service"
sed -e "s#/opt/jixie#$JIXIE_DIR#g" \
    -e "s#/var/lib/jixie#$JIXIE_DATA_DIR#g" \
    -e "s#^User=jixie#User=$JIXIE_DEPLOY_USER#" \
    -e "s#^Group=jixie#Group=$JIXIE_DEPLOY_USER#" \
    "$JIXIE_DIR/deploy/jixie-api.service" | sudo tee "$UNIT_DST" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$JIXIE_SERVICE"
sudo systemctl restart "$JIXIE_SERVICE"

log "安装 daily / weekly / backup timers"
for unit in \
  jixie-maintenance.service \
  jixie-maintenance.timer \
  jixie-maintenance-weekly.service \
  jixie-maintenance-weekly.timer \
  jixie-backup.service \
  jixie-backup.timer; do
  sed -e "s#/opt/jixie#$JIXIE_DIR#g" \
      -e "s#/var/lib/jixie#$JIXIE_DATA_DIR#g" \
      -e "s#/var/backups/jixie#$JIXIE_BACKUP_DIR#g" \
      -e "s#jixie-api.service#$JIXIE_SERVICE.service#g" \
      -e "s#^User=jixie#User=$JIXIE_DEPLOY_USER#" \
      -e "s#^Group=jixie#Group=$JIXIE_DEPLOY_USER#" \
      "$JIXIE_DIR/deploy/$unit" | sudo tee "/etc/systemd/system/$unit" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now jixie-backup.timer
sudo systemctl disable --now \
  jixie-maintenance.timer \
  jixie-maintenance-weekly.timer

# ─────────────────────────────── 7. nginx vhost ───────────────────────────────
NGINX_DST="/etc/nginx/sites-available/$JIXIE_DOMAIN"
# CentOS 无 sites-available 约定,退回 conf.d
[[ -d /etc/nginx/sites-available ]] || NGINX_DST="/etc/nginx/conf.d/$JIXIE_DOMAIN.conf"
if nginx_vhost_has_tls "$NGINX_DST"; then
  log "nginx vhost 已含 TLS,保留 certbot 改写结果"
  if ! sudo grep -Fq "$JIXIE_DIR/deploy/nginx-docs-app.conf" "$NGINX_DST"; then
    warn "现有 TLS vhost 尚未 include deploy/nginx-docs-app.conf;公开文档路由需按 docs/deployment.md §3 完成一次性迁移"
  fi
else
  log "安装/更新 nginx vhost ($JIXIE_DOMAIN)"
  sed -e "s#/opt/jixie#$JIXIE_DIR#g" \
      -e "s#jixie.example.com#$JIXIE_DOMAIN#g" \
      -e "s#127.0.0.1:3001#127.0.0.1:$JIXIE_PORT#g" \
      "$JIXIE_DIR/deploy/nginx-jixie.conf" | sudo tee "$NGINX_DST" >/dev/null
  [[ -d /etc/nginx/sites-enabled ]] && sudo ln -sf "$NGINX_DST" "/etc/nginx/sites-enabled/$JIXIE_DOMAIN"
fi
sudo nginx -t && sudo systemctl reload nginx

# ─────────────────────────────── 8. TLS(certbot) ───────────────────────────────
if [[ "$JIXIE_TLS" == "auto" ]]; then
  if sudo certbot certificates 2>/dev/null | grep -Fq "$JIXIE_DOMAIN"; then
    log "证书已存在,跳过签发"
  else
    log "尝试用 certbot 签发证书(HTTP-01)—— 需域名已解析到本机 80 端口"
    CERTBOT_ARGS=(--nginx -d "$JIXIE_DOMAIN" --non-interactive --agree-tos --redirect)
    [[ -n "$JIXIE_TLS_EMAIL" ]] && CERTBOT_ARGS+=(-m "$JIXIE_TLS_EMAIL") || CERTBOT_ARGS+=(--register-unsafely-without-email)
    sudo certbot "${CERTBOT_ARGS[@]}" || warn "certbot 失败 —— 站点仍 HTTP 可用。域名走 Cloudflare 需临时切灰云;详见 docs/deployment.md。"
  fi
else
  warn "JIXIE_TLS=skip,跳过证书。注意:NODE_ENV=production 用 secure cookie,纯 HTTP 下登录不保持!"
fi

# ─────────────────────────────── 9. 激活维护与冒烟测试 ───────────────────────────────
flock -u 9
unset JIXIE_MAINTENANCE_LOCK_HELD
"$JIXIE_DIR/scripts/activate-maintenance.sh"

log "冒烟测试"
sleep 1
systemctl is-active --quiet "$JIXIE_SERVICE" \
  && echo "  service: active @ $(git -C "$JIXIE_DIR" rev-parse --short HEAD)" \
  || die "$JIXIE_SERVICE 未运行,查日志: journalctl -u $JIXIE_SERVICE -e"
HEALTH="$(curl -fsS "localhost:$JIXIE_PORT/api/health" 2>/dev/null || true)"
echo "  /api/health: ${HEALTH:-<无响应>}"
[[ "$HEALTH" == *'"ok":true'* ]] || warn "健康检查未过,查日志: journalctl -u $JIXIE_SERVICE -e"

ROWS="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "Daily";' 2>/dev/null || echo 0)"
WATERMARK="$(sqlite3 "$DB_FILE" 'SELECT dailyPublishedThrough FROM "MaintenanceState" WHERE key = "global";' 2>/dev/null || true)"
[[ "${ROWS:-0}" -gt 0 && -n "$WATERMARK" ]] ||
  die "行情数据或连续发布水位未准备完成"

log "完成 ✅  访问: https://$JIXIE_DOMAIN  (若 TLS 未签发则 http://)"
cat <<EOF

以后安装、更新、迁移和资源补全都运行:
  cd $JIXIE_DIR && ./scripts/bootstrap.sh

定时任务: systemctl list-timers 'jixie-*'
EOF
