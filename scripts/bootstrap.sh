#!/usr/bin/env bash
# jixie 一键「从零」部署 —— 在 VPS 上以普通 sudo 用户(如 ubuntu)执行,幂等可重复跑。
#
#   ssh 登录后:  cd /opt/jixie && ./scripts/bootstrap.sh
#   (首次机器上还没有代码时,先把这个脚本单独 scp 上去跑,它会自己 clone。)
#
# 与 scripts/deploy.sh 的区别:
#   - deploy.sh    = 日常「pull & restart」,要求机器已 provisioning 完毕。
#   - bootstrap.sh = 从一台干净(或半干净)的 Ubuntu/CentOS 机器把站点搭到能访问。
#
# 幂等:已装依赖不重装、已有代码 pull 不重 clone、已存在的 .env.production 不覆盖(只 upsert 注入的密钥)、
# 已被 certbot 改写的 HTTPS vhost 不覆盖、默认邀请码只在新库首次生成。
#
# 全部配置走 env var。⚠ 行情数据本脚本不碰 —— 它建的是空库 schema;数据要另跑 `pnpm sync` 回填
# 或从本机传库,见 docs/deployment.md。
set -euo pipefail

# ─────────────────────────────── 配置(env var 覆盖) ───────────────────────────────
JIXIE_REPO="${JIXIE_REPO:-https://github.com/mefive/jixie.git}"
JIXIE_BRANCH="${JIXIE_BRANCH:-main}"
JIXIE_DIR="${JIXIE_DIR:-/opt/jixie}"
JIXIE_DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
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
have nginx   || PKGS+=(nginx)
have sqlite3 || PKGS+=(sqlite3)     # backup 脚本(scripts/backup-db.mjs)依赖 sqlite3 CLI
# certbot + 其 nginx 插件(两发行版包名一致:python3-certbot-nginx)
have certbot || PKGS+=(certbot python3-certbot-nginx)
if ((${#PKGS[@]})); then
  log "安装: ${PKGS[*]}"
  pkg_install "${PKGS[@]}"
fi

# Node 20+:缺失或主版本 <20 则走 NodeSource 装 20.x
NODE_OK=0
if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$NODE_MAJOR" -ge 20 ]] && NODE_OK=1
fi
if [[ "$NODE_OK" -ne 1 ]]; then
  log "安装 Node.js 20.x (NodeSource)"
  if [[ "$PKG" == apt ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    pkg_install nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
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

# ─────────────────────────────── 2. 拉代码 ───────────────────────────────
if [[ -d "$JIXIE_DIR/.git" ]]; then
  log "代码已存在,git pull --ff-only"
  git -C "$JIXIE_DIR" fetch origin "$JIXIE_BRANCH"
  git -C "$JIXIE_DIR" checkout "$JIXIE_BRANCH"
  git -C "$JIXIE_DIR" pull --ff-only
else
  log "首次 clone 到 $JIXIE_DIR"
  sudo mkdir -p "$JIXIE_DIR"
  sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" "$JIXIE_DIR"
  git clone --branch "$JIXIE_BRANCH" "$JIXIE_REPO" "$JIXIE_DIR" \
    || die "git clone 失败 —— 私有仓库需在本机配 GitHub 访问凭据(SSH key / deploy token)。"
fi
cd "$JIXIE_DIR"

# ─────────────────────────────── 3. 数据目录(DB 落在代码目录外) ───────────────────────────────
log "准备数据目录 $JIXIE_DATA_DIR"
sudo mkdir -p "$JIXIE_DATA_DIR"
sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" "$JIXIE_DATA_DIR"
DB_FILE="$JIXIE_DATA_DIR/prod.db"
DB_ALREADY_EXISTS=0
[[ -f "$DB_FILE" ]] && DB_ALREADY_EXISTS=1

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

log "pnpm -r build (拓扑序: shared -> api -> web)"
# ⚠ 内存:vite build + 回测都偏吃内存。<2GB 的 VPS 建议配 swap,或本机构建后 rsync apps/web/dist。
pnpm -r build

if [[ "$JIXIE_INVITES_EXPLICIT" -ne 1 && "$DB_ALREADY_EXISTS" -eq 1 ]]; then
  log "数据库已存在,跳过默认邀请码生成(如需补发,显式设 JIXIE_INVITES=N)"
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

# ─────────────────────────────── 7. nginx vhost ───────────────────────────────
NGINX_DST="/etc/nginx/sites-available/$JIXIE_DOMAIN"
# CentOS 无 sites-available 约定,退回 conf.d
[[ -d /etc/nginx/sites-available ]] || NGINX_DST="/etc/nginx/conf.d/$JIXIE_DOMAIN.conf"
if nginx_vhost_has_tls "$NGINX_DST"; then
  log "nginx vhost 已含 TLS,保留 certbot 改写结果"
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

# ─────────────────────────────── 9. 冒烟测试 ───────────────────────────────
log "冒烟测试"
sleep 1
systemctl is-active --quiet "$JIXIE_SERVICE" \
  && echo "  service: active @ $(git -C "$JIXIE_DIR" rev-parse --short HEAD)" \
  || die "$JIXIE_SERVICE 未运行,查日志: journalctl -u $JIXIE_SERVICE -e"
HEALTH="$(curl -fsS "localhost:$JIXIE_PORT/api/health" 2>/dev/null || true)"
echo "  /api/health: ${HEALTH:-<无响应>}"
[[ "$HEALTH" == *'"ok":true'* ]] || warn "健康检查未过,查日志: journalctl -u $JIXIE_SERVICE -e"

# 行情数据检查:空库提醒回填
ROWS="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "Daily";' 2>/dev/null || echo 0)"
if [[ "${ROWS:-0}" -eq 0 ]]; then
  warn "行情库为空(Daily 0 行)—— 站点能开但没数据。回填见下。"
fi

log "完成 ✅  访问: https://$JIXIE_DOMAIN  (若 TLS 未签发则 http://)"
cat <<EOF

下一步 —— 回填行情数据(二选一):
  A. VPS 自己同步(按年断点续传,后台跑;首轮全量数小时~1天):
       cd $JIXIE_DIR
       pnpm --filter api sync 20150101 20151231     # 逐年:daily/adj/basic
       pnpm --filter api sync:limit 20200101 20241231
       pnpm --filter api sync:moneyflow 20200101 20241231
       pnpm --filter api sync:toplist 20200101 20241231
       pnpm --filter api sync:fina && pnpm --filter api sync:index
  B. 从本机传库(最快,带研究史):本机 pnpm --filter api backup,
       再 rsync ~/jixie-backups/dev-*.db 到 $DB_FILE(停服→替换→起服)。
  详见 docs/deployment.md。

日常更新: cd $JIXIE_DIR && ./scripts/deploy.sh
EOF
