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
JIXIE_BOOTSTRAP_CONFIG_FILE="${JIXIE_BOOTSTRAP_CONFIG_FILE:-/etc/jixie/bootstrap.env}"
JIXIE_CONFIG_KEYS=(
  JIXIE_REPO
  JIXIE_BRANCH
  JIXIE_DIR
  JIXIE_DATA_DIR
  JIXIE_BACKUP_DIR
  JIXIE_PORT
  JIXIE_DOMAIN
  JIXIE_SERVICE
  JIXIE_DEPLOY_USER
  JIXIE_TLS
  JIXIE_TLS_EMAIL
)
declare -A JIXIE_EXPLICIT_CONFIG=()
for config_key in "${JIXIE_CONFIG_KEYS[@]}"; do
  [[ -n "${!config_key+x}" ]] && JIXIE_EXPLICIT_CONFIG["$config_key"]=1
done

# Parse only known literal KEY=VALUE entries. The persistent file is data, never executable shell.
if [[ -e "$JIXIE_BOOTSTRAP_CONFIG_FILE" ]]; then
  [[ -r "$JIXIE_BOOTSTRAP_CONFIG_FILE" ]] ||
    {
      printf '[err] 部署配置不可读: %s\n' "$JIXIE_BOOTSTRAP_CONFIG_FILE" >&2
      exit 1
    }
  while IFS= read -r config_line || [[ -n "$config_line" ]]; do
    [[ -z "$config_line" || "$config_line" == \#* || "$config_line" != *=* ]] && continue
    config_key="${config_line%%=*}"
    config_value="${config_line#*=}"
    [[ " ${JIXIE_CONFIG_KEYS[*]} " == *" $config_key "* ]] || continue
    [[ -n "${JIXIE_EXPLICIT_CONFIG[$config_key]:-}" ]] && continue
    printf -v "$config_key" '%s' "$config_value"
  done <"$JIXIE_BOOTSTRAP_CONFIG_FILE"
fi

JIXIE_REPO="${JIXIE_REPO:-https://github.com/mefive/jixie.git}"
JIXIE_BRANCH="${JIXIE_BRANCH:-main}"
JIXIE_DIR="${JIXIE_DIR:-/opt/jixie}"
JIXIE_DATA_DIR="${JIXIE_DATA_DIR:-/var/lib/jixie}"
JIXIE_BACKUP_DIR="${JIXIE_BACKUP_DIR:-/var/backups/jixie}"
JIXIE_BOOTSTRAP_LOCK_FILE="${JIXIE_BOOTSTRAP_LOCK_FILE:-/tmp/jixie-bootstrap.lock}"
JIXIE_PORT="${JIXIE_PORT:-3001}"
JIXIE_DOMAIN="${JIXIE_DOMAIN:-}"
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

is_valid_production_domain() {
  local domain="$1"
  [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] &&
    [[ "$domain" == *.* ]] &&
    [[ "$domain" != "example.com" ]] &&
    [[ "$domain" != *.example.com ]]
}

discover_existing_domain() {
  local nginx_directory nginx_file domain_token
  local -a nginx_files=()
  declare -A domains=()

  for nginx_directory in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [[ -d "$nginx_directory" ]] || continue
    while IFS= read -r -d '' nginx_file; do
      nginx_files+=("$nginx_file")
    done < <(sudo find -L "$nginx_directory" -maxdepth 1 -type f -print0 2>/dev/null)
  done

  for nginx_file in "${nginx_files[@]}"; do
    if ! sudo grep -Fq "$JIXIE_DIR/apps/web/dist" "$nginx_file" &&
      ! sudo grep -Fq "$JIXIE_DIR/deploy/nginx-docs-app.conf" "$nginx_file"; then
      continue
    fi

    while IFS= read -r domain_token; do
      domain_token="${domain_token%;}"
      if is_valid_production_domain "$domain_token"; then
        domains["$domain_token"]=1
      fi
    done < <(
      sudo awk '
        $1 == "server_name" {
          for (index = 2; index <= NF; index += 1) {
            print $index
          }
        }
      ' "$nginx_file"
    )
  done

  if ((${#domains[@]} == 1)); then
    printf '%s\n' "${!domains[@]}"
  elif ((${#domains[@]} > 1)); then
    warn "从现有 Jixie nginx 配置发现多个域名: ${!domains[*]}"
  fi
}

persist_bootstrap_config() {
  local config_key config_value temporary_file

  temporary_file="$(mktemp)"
  for config_key in "${JIXIE_CONFIG_KEYS[@]}"; do
    config_value="${!config_key}"
    [[ "$config_value" != *$'\n'* && "$config_value" != *$'\r'* ]] ||
      die "$config_key 不能包含换行"
    printf '%s=%s\n' "$config_key" "$config_value" >>"$temporary_file"
  done
  sudo install -D -m 0644 "$temporary_file" "$JIXIE_BOOTSTRAP_CONFIG_FILE"
  rm -f "$temporary_file"
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

market_reference_coverage() {
  local database_file="$1"
  local reference_start="$2"

  sqlite3 -separator ' ' "$database_file" "
    WITH weather_codes(code) AS (
      VALUES
        ('000985.CSI'), ('000016.SH'), ('930050.CSI'), ('000903.SH'), ('000300.SH'),
        ('000510.SH'), ('000906.SH'), ('000905.SH'), ('000852.SH'), ('932000.CSI'),
        ('000001.SH'), ('399001.SZ'), ('399006.SZ'), ('399102.SZ'), ('000680.SH'),
        ('000688.SH'), ('931643.CSI'), ('899050.BJ'), ('000918.CSI'), ('000919.CSI'),
        ('H30351.CSI'), ('H30352.CSI'), ('H30355.CSI'), ('H30356.CSI'), ('932392.CSI'),
        ('932393.CSI'), ('399370.SZ'), ('399371.SZ'), ('000922.CSI'), ('000984.CSI'),
        ('H30260.CSI'), ('930860.CSI'), ('930955.CSI'), ('980092.SZ')
    )
    SELECT
      (SELECT count(*) FROM \"IndexBenchmark\"),
      (SELECT count(*) FROM (
        SELECT \"tsCode\"
        FROM \"SwIndexDaily\"
        GROUP BY \"tsCode\"
        HAVING min(\"tradeDate\") <= '$reference_start'
      )),
      (SELECT count(*) FROM (
        SELECT \"tsCode\"
        FROM \"IndexDaily\"
        WHERE \"tsCode\" IN (SELECT code FROM weather_codes)
        GROUP BY \"tsCode\"
        HAVING count(*) >= 120
      )),
      (SELECT count(*) FROM (
        SELECT \"indexCode\"
        FROM \"IndexWeight\"
        WHERE \"indexCode\" IN (SELECT code FROM weather_codes)
        GROUP BY \"indexCode\"
      )),
      (SELECT count(*) FROM (
        SELECT \"indexCode\"
        FROM \"IndexIndicator\"
        WHERE \"indexCode\" IN (SELECT code FROM weather_codes)
        GROUP BY \"indexCode\"
      ));
  "
}

commodity_etf_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH candidates(code, list_date) AS (
      VALUES
        ('159985.SZ', '20191205'),
        ('159980.SZ', '20191224'),
        ('159981.SZ', '20200117')
    ),
    coverage AS (
      SELECT
        candidates.code,
        candidates.list_date,
        min(daily.\"tradeDate\") AS first_date,
        max(daily.\"tradeDate\") AS last_date,
        count(daily.\"tradeDate\") AS daily_rows,
        count(adjustment.\"tradeDate\") AS adjustment_rows
      FROM candidates
      LEFT JOIN \"EtfDaily\" AS daily ON daily.\"tsCode\" = candidates.code
      LEFT JOIN \"EtfAdjFactor\" AS adjustment
        ON adjustment.\"tsCode\" = daily.\"tsCode\"
       AND adjustment.\"tradeDate\" = daily.\"tradeDate\"
      GROUP BY candidates.code, candidates.list_date
    )
    SELECT count(*)
    FROM coverage
    WHERE first_date <= list_date
      AND last_date >= '$expected_end'
      AND daily_rows = adjustment_rows;
  "
}

macro_series_coverage() {
  local database_file="$1"

  sqlite3 "$database_file" "
    WITH required(series_key, first_period, minimum_rows) AS (
      VALUES
        ('cn_pmi_manufacturing', '200501', 200),
        ('cn_cpi_yoy', '200501', 200),
        ('cn_ppi_yoy', '200501', 200),
        ('cn_m1_balance', '200501', 200),
        ('cn_m1_yoy', '200501', 200),
        ('cn_m2_balance', '200501', 200),
        ('cn_m2_yoy', '200501', 200),
        ('cn_social_financing_increment', '200501', 200),
        ('cn_social_financing_stock', '200512', 100),
        ('cn_shibor_overnight', '20061009', 2000),
        ('cn_shibor_1w', '20061009', 2000),
        ('cn_shibor_1m', '20061009', 2000),
        ('cn_shibor_3m', '20061009', 2000)
    ),
    coverage AS (
      SELECT
        required.series_key,
        required.first_period AS required_first_period,
        required.minimum_rows,
        min(observation.\"period\") AS observed_first_period,
        count(observation.\"period\") AS observation_rows
      FROM required
      LEFT JOIN \"MacroObservation\" AS observation
        ON observation.\"seriesKey\" = required.series_key
      GROUP BY required.series_key, required.first_period, required.minimum_rows
    )
    SELECT count(*)
    FROM coverage
    WHERE observed_first_period <= required_first_period
      AND observation_rows >= minimum_rows;
  "
}

external_market_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH coverage(series_key, first_date, last_available, observation_rows) AS (
      SELECT
        'us_treasury_nominal',
        min(\"tradeDate\"),
        max(\"availableDate\"),
        count(*)
      FROM \"YieldCurvePoint\"
      WHERE \"curveCode\" = 'us_treasury_nominal' AND \"termYears\" = 10
      UNION ALL
      SELECT
        'us_treasury_real',
        min(\"tradeDate\"),
        max(\"availableDate\"),
        count(*)
      FROM \"YieldCurvePoint\"
      WHERE \"curveCode\" = 'us_treasury_real' AND \"termYears\" = 10
      UNION ALL
      SELECT
        'USDCNH.FXCM',
        min(\"tradeDate\"),
        max(\"availableDate\"),
        count(*)
      FROM \"FxDaily\"
      WHERE \"tsCode\" = 'USDCNH.FXCM'
    )
    SELECT count(*)
    FROM coverage
    WHERE last_available >= '$expected_end'
      AND (
        (series_key IN ('us_treasury_nominal', 'us_treasury_real')
          AND first_date <= '20050103' AND observation_rows >= 4000)
        OR
        (series_key = 'USDCNH.FXCM'
          AND first_date <= '20120218' AND observation_rows >= 2000)
      );
  "
}

credit_curve_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH required(curve_code, latest_first_date, minimum_rows) AS (
      VALUES
        ('chinabond_cgb_ytm', '20060301', 4000),
        ('chinabond_cp_note_aaa_ytm', '20100101', 3000),
        ('chinabond_bank_aaa_ytm', '20100101', 3000)
    ),
    coverage AS (
      SELECT
        required.curve_code,
        required.latest_first_date,
        required.minimum_rows,
        min(point.\"tradeDate\") AS first_date,
        max(point.\"availableDate\") AS last_available,
        count(point.\"tradeDate\") AS observation_rows
      FROM required
      LEFT JOIN \"YieldCurvePoint\" AS point
        ON point.\"curveCode\" = required.curve_code
       AND point.\"termYears\" = 5
      GROUP BY required.curve_code, required.latest_first_date, required.minimum_rows
    )
    SELECT count(*)
    FROM coverage
    WHERE first_date <= latest_first_date
      AND last_available >= '$expected_end'
      AND observation_rows >= minimum_rows;
  "
}

commodity_future_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH required(product_code, latest_first_date, minimum_rows) AS (
      VALUES
        ('AU', '20150105', 10000),
        ('CU', '20150105', 15000),
        ('M', '20150105', 10000),
        ('SC', '20180326', 10000)
    ),
    coverage AS (
      SELECT
        required.product_code,
        required.latest_first_date,
        required.minimum_rows,
        min(daily.\"tradeDate\") AS first_date,
        max(daily.\"tradeDate\") AS last_date,
        count(daily.\"tradeDate\") AS observation_rows
      FROM required
      LEFT JOIN \"FutureContract\" AS contract
        ON contract.\"productCode\" = required.product_code
      LEFT JOIN \"FutureDaily\" AS daily
        ON daily.\"tsCode\" = contract.\"tsCode\"
      GROUP BY required.product_code, required.latest_first_date, required.minimum_rows
    )
    SELECT count(*)
    FROM coverage
    WHERE first_date <= latest_first_date
      AND last_date >= '$expected_end'
      AND observation_rows >= minimum_rows;
  "
}

commodity_holding_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH required(product_code) AS (VALUES ('AU'), ('CU'), ('M')),
    coverage AS (
      SELECT
        required.product_code,
        min(position.\"tradeDate\") AS first_date,
        max(position.\"availableDate\") AS last_available,
        count(position.\"tradeDate\") AS observation_rows
      FROM required
      LEFT JOIN \"CommodityHoldingPosition\" AS position
        ON position.\"productCode\" = required.product_code
      GROUP BY required.product_code
    )
    SELECT count(*)
    FROM coverage
    WHERE first_date <= '20150105'
      AND last_available >= '$expected_end'
      AND observation_rows >= 2000;
  "
}

commodity_continuous_return_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH required(product_code, continuous_code, latest_first_date, minimum_rows) AS (
      VALUES
        ('AU', 'AU.SHF', '20150105', 2500),
        ('CU', 'CU.SHF', '20150105', 2500),
        ('SC', 'SC.INE', '20180326', 1800),
        ('M', 'M.DCE', '20150105', 2500)
    ),
    mapping_coverage AS (
      SELECT
        mapping.\"continuousCode\" AS continuous_code,
        min(mapping.\"tradeDate\") AS first_mapping,
        max(mapping.\"tradeDate\") AS last_mapping
      FROM \"FutureMapping\" AS mapping
      GROUP BY mapping.\"continuousCode\"
    ),
    return_coverage AS (
      SELECT
        return_row.\"productCode\" AS product_code,
        count(return_row.\"tradeDate\") AS return_rows,
        max(return_row.\"availableDate\") AS last_available,
        max(return_row.\"tradeDate\") AS last_return
      FROM \"CommodityContinuousReturn\" AS return_row
      GROUP BY return_row.\"productCode\"
    )
    SELECT count(*)
    FROM required
    JOIN mapping_coverage
      ON mapping_coverage.continuous_code = required.continuous_code
    JOIN return_coverage
      ON return_coverage.product_code = required.product_code
    WHERE mapping_coverage.first_mapping <= required.latest_first_date
      AND mapping_coverage.last_mapping >= '$expected_end'
      AND return_coverage.last_available >= '$expected_end'
      AND return_coverage.last_return >= '$expected_end'
      AND return_coverage.return_rows >= required.minimum_rows;
  "
}

commodity_warehouse_receipt_coverage() {
  local database_file="$1"
  local expected_end="$2"

  sqlite3 "$database_file" "
    WITH required(product_code) AS (
      VALUES ('AU'), ('CU'), ('SC'), ('M')
    ),
    recent_threshold AS (
      SELECT coalesce(
        (
          SELECT \"calDate\"
          FROM \"TradeCal\"
          WHERE \"exchange\" = 'SSE'
            AND \"isOpen\" = 1
            AND \"calDate\" <= '$expected_end'
          ORDER BY \"calDate\" DESC
          LIMIT 1 OFFSET 9
        ),
        '00000000'
      ) AS minimum_recent_date
    ),
    coverage AS (
      SELECT
        required.product_code,
        max(receipt.\"tradeDate\") AS last_date,
        count(receipt.\"tradeDate\") AS receipt_rows
      FROM required
      LEFT JOIN \"CommodityWarehouseReceipt\" AS receipt
        ON receipt.\"productCode\" = required.product_code
      GROUP BY required.product_code
    )
    SELECT count(*)
    FROM coverage, recent_threshold
    WHERE receipt_rows >= 500
      AND last_date >= minimum_recent_date;
  "
}

STAGING_DIR=""
ACTIVE_LIVE_DIR=""
ACTIVE_PREVIOUS_DIR=""
NODE_HEAP_OPTIONS="--max-old-space-size=4096"

recover_interrupted_activation() {
  local live_dir="$1"
  local previous_dir="$live_dir.deploy-previous"

  if [[ ! -e "$live_dir" && -e "$previous_dir" ]]; then
    log "恢复中断的静态资源切换: $live_dir"
    mv -- "$previous_dir" "$live_dir"
  elif [[ -e "$live_dir" && -e "$previous_dir" ]]; then
    rm -rf -- "$previous_dir"
  fi
}

activate_static_build() {
  local live_dir="$1"
  local staging_dir="$2"
  local previous_dir="$live_dir.deploy-previous"

  [[ -f "$staging_dir/index.html" ]] || die "静态构建不完整: $staging_dir/index.html"
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
  log "在 staging 中 typecheck + build $package_name"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter "$package_name" exec tsc --noEmit
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter "$package_name" exec vite build \
    --outDir "$STAGING_DIR" \
    --emptyOutDir
  chmod -R a+rX "$STAGING_DIR"

  log "原子切换 $package_name 静态资源"
  activate_static_build "$live_dir" "$STAGING_DIR"
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
have podman  || PKGS+=(podman)      # rootless runtime for untrusted Python strategy containers
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

if [[ -z "$JIXIE_DOMAIN" ]]; then
  JIXIE_DOMAIN="$(discover_existing_domain)"
  if [[ -n "$JIXIE_DOMAIN" ]]; then
    log "从现有 Jixie nginx 配置识别域名: $JIXIE_DOMAIN"
  else
    die "未配置且无法唯一识别生产域名。首次运行请使用 JIXIE_DOMAIN=你的域名 ./scripts/bootstrap.sh"
  fi
fi
is_valid_production_domain "$JIXIE_DOMAIN" ||
  die "拒绝无效或占位域名 '$JIXIE_DOMAIN';请设置真实生产域名"
case "$JIXIE_TLS" in
  auto | skip) ;;
  *) die "JIXIE_TLS 只能是 auto 或 skip" ;;
esac
persist_bootstrap_config

log "目标配置"
cat <<EOF
  代码目录   : $JIXIE_DIR  (来自 $JIXIE_REPO @ $JIXIE_BRANCH)
  数据目录   : $JIXIE_DATA_DIR  (prod.db 落这里,不在 git 内)
  域名/端口  : $JIXIE_DOMAIN  ->  127.0.0.1:$JIXIE_PORT
  systemd    : $JIXIE_SERVICE  (User=$JIXIE_DEPLOY_USER)
  TLS        : $JIXIE_TLS
  持久配置   : $JIXIE_BOOTSTRAP_CONFIG_FILE
  包管理器   : $PKG
EOF

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
JIXIE_DEPLOY_UID="$(id -u "$JIXIE_DEPLOY_USER")"
JIXIE_DEPLOY_HOME="$(getent passwd "$JIXIE_DEPLOY_USER" | cut -d: -f6)"
[[ -n "$JIXIE_DEPLOY_HOME" ]] || die "无法读取部署用户 $JIXIE_DEPLOY_USER 的 home"
JIXIE_USER_RUNTIME_DIR="/run/user/$JIXIE_DEPLOY_UID"
sudo loginctl enable-linger "$JIXIE_DEPLOY_USER"
sudo systemctl start "user@$JIXIE_DEPLOY_UID.service"
podman_as_deploy_user() {
  if [[ "$(id -un)" == "$JIXIE_DEPLOY_USER" ]]; then
    XDG_RUNTIME_DIR="$JIXIE_USER_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=$JIXIE_USER_RUNTIME_DIR/bus" podman "$@"
  else
    sudo -H -u "$JIXIE_DEPLOY_USER" env \
      XDG_RUNTIME_DIR="$JIXIE_USER_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=$JIXIE_USER_RUNTIME_DIR/bus" podman "$@"
  fi
}
PODMAN_ROOTLESS="$(podman_as_deploy_user info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" ||
  die "部署用户 $JIXIE_DEPLOY_USER 无法启动 rootless Podman；请检查 /etc/subuid、/etc/subgid 和 podman info"
[[ "$PODMAN_ROOTLESS" == "true" ]] || die "拒绝以 root 模式运行 Python 策略沙箱"
PODMAN_CGROUP_VERSION="$(podman_as_deploy_user info --format '{{.Host.CgroupsVersion}}')"
[[ "$PODMAN_CGROUP_VERSION" == "v2" ]] ||
  die "Python 策略资源限制要求 cgroups v2，当前 Podman 报告 $PODMAN_CGROUP_VERSION"
DB_FILE="$JIXIE_DATA_DIR/prod.db"
exec 9>>"$JIXIE_DATA_DIR/maintenance.lock"
flock -n -E 75 9 || die "maintenance 正在运行,本次 bootstrap 不与其并发"
export JIXIE_MAINTENANCE_LOCK_HELD=1

SUCCESSFUL_REVISION_FILE="$JIXIE_DATA_DIR/deployed-revision"
DEPLOYED_REVISION=""
if [[ -f "$SUCCESSFUL_REVISION_FILE" ]]; then
  IFS= read -r DEPLOYED_REVISION <"$SUCCESSFUL_REVISION_FILE" || true
fi
read -r DEPLOY_API DEPLOY_WEB DEPLOY_DOCS DEPLOY_SANDBOXD DEPLOY_FULL INSTALL_DEPENDENCIES < <(
  node --no-warnings "$JIXIE_DIR/scripts/plan-deployment.mjs" \
    --repository "$JIXIE_DIR" \
    --base "$DEPLOYED_REVISION" \
    --head "$CURRENT_REVISION"
)

if [[ ! -d "$JIXIE_DIR/node_modules" || ! -d "$JIXIE_DIR/packages/shared/dist" ]]; then
  DEPLOY_API=1
  DEPLOY_WEB=1
  DEPLOY_DOCS=1
  DEPLOY_SANDBOXD=1
  DEPLOY_FULL=1
  INSTALL_DEPENDENCIES=1
fi
[[ -f "$JIXIE_DIR/apps/web/dist/index.html" ]] || DEPLOY_WEB=1
[[ -f "$JIXIE_DIR/apps/docs/dist/docs/index.html" ]] || DEPLOY_DOCS=1
[[ -f "$JIXIE_DIR/apps/sandboxd/dist/src/index.js" ]] || DEPLOY_SANDBOXD=1
if [[ ! -f "$DB_FILE" ]] || ! systemctl is-active --quiet "$JIXIE_SERVICE" 2>/dev/null; then
  DEPLOY_API=1
fi
# Restart the API through its maintenance gate when the runtime it connects to changes.
[[ "$DEPLOY_SANDBOXD" == "1" ]] && DEPLOY_API=1

log "本次部署范围: api=$DEPLOY_API web=$DEPLOY_WEB docs=$DEPLOY_DOCS sandboxd=$DEPLOY_SANDBOXD install=$INSTALL_DEPENDENCIES"

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

DEPLOYMENT_RUN_ID=""

finish_deployment_gate() {
  local outcome="$1"
  [[ -n "$DEPLOYMENT_RUN_ID" ]] || return 0

  node --no-warnings "$JIXIE_DIR/scripts/deployment-gate.mjs" \
    finish "$DB_FILE" "$DEPLOYMENT_RUN_ID" "$outcome"
  DEPLOYMENT_RUN_ID=""
}

cleanup_deployment_gate() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$ACTIVE_LIVE_DIR" && ! -e "$ACTIVE_LIVE_DIR" && -e "$ACTIVE_PREVIOUS_DIR" ]]; then
    mv -- "$ACTIVE_PREVIOUS_DIR" "$ACTIVE_LIVE_DIR" || true
  fi
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi
  if [[ -n "$DEPLOYMENT_RUN_ID" ]]; then
    finish_deployment_gate error || true
  fi
  exit "$exit_code"
}

trap cleanup_deployment_gate EXIT

if [[ "$DEPLOY_API" == "1" ]] && systemctl is-active --quiet "$JIXIE_SERVICE" 2>/dev/null; then
  MAINTENANCE_TABLE_EXISTS="$(
    sqlite3 "$DB_FILE" \
      "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'MaintenanceRun';" \
      2>/dev/null ||
      echo 0
  )"
  if [[ "$MAINTENANCE_TABLE_EXISTS" -gt 0 ]]; then
    log "进入部署维护模式并等待后台任务结束"
    DEPLOYMENT_RUN_ID="$(
      node --no-warnings "$JIXIE_DIR/scripts/deployment-gate.mjs" \
        begin "$DB_FILE" "$CURRENT_REVISION"
    )"
    [[ -n "$DEPLOYMENT_RUN_ID" ]] || die "无法创建部署维护状态"
  else
    warn "旧数据库尚无维护状态表,直接停止 API 完成首次 schema 升级"
  fi

  log "停止 $JIXIE_SERVICE,避免部署期间混用新旧代码并释放 SQLite 连接"
  sudo systemctl stop "$JIXIE_SERVICE"
fi

# ─────────────────────────────── 5. 安装 / 迁移 / 构建 ───────────────────────────────
if [[ "$INSTALL_DEPENDENCIES" == "1" ]]; then
  log "pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
else
  log "依赖清单未变化且 node_modules 已存在,跳过 pnpm install"
fi

if [[ "$DEPLOY_API" == "1" || "$DEPLOY_WEB" == "1" || "$DEPLOY_DOCS" == "1" ]]; then
  log "构建 @jixie/shared"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter @jixie/shared build
fi

if [[ "$DEPLOY_API" == "1" ]]; then
  log "prisma generate"
  pnpm --filter api exec prisma generate

  log "构建 API"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter api build

  log "迁移 Screen 数据到 Research 并清理旧 Agent 副本（schema 升级前，幂等）"
  pnpm --filter api migrate:screen-to-research -- --finalize

  log "补齐 Factor 唯一 key（幂等）"
  pnpm --filter api migrate:factor-identity

  log "prisma migrate deploy (建库/升级 schema 于 $DB_FILE)"
  pnpm --filter api exec prisma migrate deploy

  # An empty database older than AgentConversation defers the pre-schema migration. Run it again
  # after schema deployment; databases with legacy rows fail before migration instead of losing data.
  log "复核 Screen 到 Research 数据迁移（schema 升级后，幂等）"
  pnpm --filter api migrate:screen-to-research

  log "补齐正式 ResearchStudy / ResearchRun 记录（幂等）"
  pnpm --filter api migrate:research-records
fi

if [[ "$DEPLOY_WEB" == "1" ]]; then
  build_static_app web "$JIXIE_DIR/apps/web" "$JIXIE_DIR/apps/web/dist"
fi

if [[ "$DEPLOY_DOCS" == "1" ]]; then
  build_static_app docs "$JIXIE_DIR/apps/docs" "$JIXIE_DIR/apps/docs/dist/docs"
fi

if [[ "$DEPLOY_SANDBOXD" == "1" ]]; then
  log "构建 Python sandbox daemon"
  NODE_OPTIONS="$NODE_HEAP_OPTIONS" pnpm --filter sandboxd build

  log "构建固定 Python runtime image"
  podman_as_deploy_user build \
    --tag jixie-python-runtime:py-v1 \
    --file "$JIXIE_DIR/apps/sandboxd/Dockerfile.python" \
    "$JIXIE_DIR/apps/sandboxd"
fi

IMPORT_REQUIRED_MARKER="$JIXIE_DATA_DIR/full-import.required"
DAILY_ROWS="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "Daily";' 2>/dev/null || echo 0)"
if [[ "${DAILY_ROWS:-0}" -eq 0 ]]; then
  touch "$IMPORT_REQUIRED_MARKER"
fi
if [[ -f "$IMPORT_REQUIRED_MARKER" ]]; then
  log "行情库尚未完成初始化,执行可断点续传的全量导入"
  pnpm import:data
  rm -f "$IMPORT_REQUIRED_MARKER"
else
  read -r MARKET_REFERENCE_START MARKET_REFERENCE_END < <(
    sqlite3 -separator ' ' "$DB_FILE" '
      SELECT
        coalesce(
          (SELECT min("tradeDate") FROM "IndustryIndicator"),
          (SELECT min("tradeDate") FROM "Daily")
        ),
        coalesce(
          (SELECT max("tradeDate") FROM "IndustryIndicator"),
          (SELECT max("tradeDate") FROM "Daily")
        );
    '
  )
  [[ "$MARKET_REFERENCE_START" =~ ^[0-9]{8}$ && "$MARKET_REFERENCE_END" =~ ^[0-9]{8}$ ]] ||
    die "无法确定官方市场参考数据的回填区间"

  read -r INDEX_BENCHMARK_ROWS SW_HISTORICAL_CODES WEATHER_HISTORICAL_CODES WEATHER_WEIGHT_CODES WEATHER_INDICATOR_CODES < <(
    market_reference_coverage "$DB_FILE" "$MARKET_REFERENCE_START"
  )
  if [[ "$INDEX_BENCHMARK_ROWS" -eq 0 || "$SW_HISTORICAL_CODES" -ne 31 || "$WEATHER_HISTORICAL_CODES" -ne 34 ]]; then
    log "补全官方指数分类、市场气象指数和申万一级行业历史行情: $MARKET_REFERENCE_START ~ $MARKET_REFERENCE_END"
    pnpm --filter api sync:market-reference "$MARKET_REFERENCE_START" "$MARKET_REFERENCE_END"

    read -r INDEX_BENCHMARK_ROWS SW_HISTORICAL_CODES WEATHER_HISTORICAL_CODES WEATHER_WEIGHT_CODES WEATHER_INDICATOR_CODES < <(
      market_reference_coverage "$DB_FILE" "$MARKET_REFERENCE_START"
    )
    [[ "$INDEX_BENCHMARK_ROWS" -gt 0 && "$SW_HISTORICAL_CODES" -eq 31 && "$WEATHER_HISTORICAL_CODES" -eq 34 ]] ||
      die "官方市场参考数据回填后仍不完整"
  else
    log "官方市场参考数据历史覆盖完整,跳过回填"
  fi

  if [[ "$WEATHER_WEIGHT_CODES" -ne 34 ]]; then
    log "补全34个市场气象指数的历史成分权重: $MARKET_REFERENCE_START ~ $MARKET_REFERENCE_END"
    pnpm --filter api sync:index market-state "$MARKET_REFERENCE_START" "$MARKET_REFERENCE_END"
  fi
  if [[ "$WEATHER_WEIGHT_CODES" -ne 34 || "$WEATHER_INDICATOR_CODES" -ne 34 ]]; then
    log "按时点成分重算市场气象广度、活跃度和估值"
    pnpm --filter api sync:market-state "$MARKET_REFERENCE_START" "$MARKET_REFERENCE_END"

    read -r INDEX_BENCHMARK_ROWS SW_HISTORICAL_CODES WEATHER_HISTORICAL_CODES WEATHER_WEIGHT_CODES WEATHER_INDICATOR_CODES < <(
      market_reference_coverage "$DB_FILE" "$MARKET_REFERENCE_START"
    )
    [[ "$WEATHER_WEIGHT_CODES" -eq 34 && "$WEATHER_INDICATOR_CODES" -eq 34 ]] ||
      die "市场气象成分权重或派生指标回填后仍不完整"
  else
    log "市场气象成分权重与派生指标覆盖完整,跳过重算"
  fi

  COMMODITY_ETF_COMPLETE="$(commodity_etf_coverage "$DB_FILE" "$MARKET_REFERENCE_END")"
  if [[ "$COMMODITY_ETF_COMPLETE" -ne 3 ]]; then
    log "补全豆粕、有色金属和能源化工 ETF 历史行情: 20191201 ~ $MARKET_REFERENCE_END"
    pnpm --filter api sync:etf 20191201 "$MARKET_REFERENCE_END" \
      159985.SZ,159980.SZ,159981.SZ refresh
    COMMODITY_ETF_COMPLETE="$(commodity_etf_coverage "$DB_FILE" "$MARKET_REFERENCE_END")"
    [[ "$COMMODITY_ETF_COMPLETE" -eq 3 ]] || die "商品 ETF 日线或复权历史回填后仍不完整"
  else
    log "商品 ETF 日线与复权历史覆盖完整,跳过回填"
  fi
fi

MACRO_SYNC_END="$(
  sqlite3 "$DB_FILE" 'SELECT substr(max("tradeDate"), 1, 6) FROM "Daily";' 2>/dev/null || true
)"
[[ "$MACRO_SYNC_END" =~ ^[0-9]{6}$ ]] || die "无法确定宏观数据同步截止月份"
MACRO_SERIES_COMPLETE="$(macro_series_coverage "$DB_FILE")"
if [[ "$MACRO_SERIES_COMPLETE" -ne 13 ]]; then
  log "补全增长、通胀、货币、信用和 Shibor 宏观 PIT 底座: 200501 ~ $MACRO_SYNC_END"
  pnpm --filter api sync:macro 200501 "$MACRO_SYNC_END"
  MACRO_SERIES_COMPLETE="$(macro_series_coverage "$DB_FILE")"
  [[ "$MACRO_SERIES_COMPLETE" -eq 13 ]] || die "宏观系列回填后仍不完整"
else
  log "宏观系列历史覆盖完整,跳过回填"
fi

EXTERNAL_MARKET_SYNC_END="$(
  sqlite3 "$DB_FILE" 'SELECT max("tradeDate") FROM "Daily";' 2>/dev/null || true
)"
[[ "$EXTERNAL_MARKET_SYNC_END" =~ ^[0-9]{8}$ ]] || die "无法确定外部市场数据同步截止日"
EXTERNAL_MARKET_COMPLETE="$(
  external_market_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
)"
if [[ "$EXTERNAL_MARKET_COMPLETE" -ne 3 ]]; then
  log "补全美国名义/实际国债曲线和 USD/CNH: 20050101 ~ $EXTERNAL_MARKET_SYNC_END"
  pnpm --filter api sync:external-market 20050101 "$EXTERNAL_MARKET_SYNC_END"
  EXTERNAL_MARKET_COMPLETE="$(
    external_market_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
  )"
  [[ "$EXTERNAL_MARKET_COMPLETE" -eq 3 ]] || die "外部市场驱动回填后仍不完整"
else
  log "外部市场驱动历史覆盖完整,跳过回填"
fi

CREDIT_CURVE_COMPLETE="$(
  credit_curve_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
)"
if [[ "$CREDIT_CURVE_COMPLETE" -ne 3 ]]; then
  log "补全中债国债、商业银行 AAA 和中短票 AAA 收益率曲线: 20060101 ~ $EXTERNAL_MARKET_SYNC_END"
  pnpm --filter api sync:credit-curves 20060101 "$EXTERNAL_MARKET_SYNC_END"
  CREDIT_CURVE_COMPLETE="$(
    credit_curve_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
  )"
  [[ "$CREDIT_CURVE_COMPLETE" -eq 3 ]] || die "中债信用曲线回填后仍不完整"
else
  log "中债信用曲线历史覆盖完整,跳过回填"
fi

COMMODITY_FUTURE_COMPLETE="$(
  commodity_future_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
)"
if [[ "$COMMODITY_FUTURE_COMPLETE" -ne 4 ]]; then
  log "补全 AU/CU/SC/M 实际月合约与日线: 20150105 ~ $EXTERNAL_MARKET_SYNC_END"
  pnpm --filter api sync:commodity-futures 20150105 "$EXTERNAL_MARKET_SYNC_END"
  COMMODITY_FUTURE_COMPLETE="$(
    commodity_future_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
  )"
  [[ "$COMMODITY_FUTURE_COMPLETE" -eq 4 ]] || die "商品期货实际合约日线回填后仍不完整"
else
  log "商品期货实际合约日线覆盖完整,跳过回填"
fi

COMMODITY_HOLDING_COMPLETE="$(
  commodity_holding_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
)"
if [[ "$COMMODITY_HOLDING_COMPLETE" -ne 3 ]]; then
  log "补全 AU/CU/M 主导实际合约的会员持仓排名: 20150105 ~ $EXTERNAL_MARKET_SYNC_END"
  pnpm --filter api sync:commodity-holdings 20150105 "$EXTERNAL_MARKET_SYNC_END"
  COMMODITY_HOLDING_COMPLETE="$(
    commodity_holding_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
  )"
  [[ "$COMMODITY_HOLDING_COMPLETE" -eq 3 ]] || die "商品会员持仓排名回填后仍不完整"
else
  log "商品会员持仓排名历史覆盖完整,跳过回填"
fi

COMMODITY_CONTINUOUS_COMPLETE="$(
  commodity_continuous_return_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
)"
if [[ "$COMMODITY_CONTINUOUS_COMPLETE" -ne 4 ]]; then
  log "补全 AU/CU/SC/M 主力映射、连续收益与换月台账: 20150105 ~ $EXTERNAL_MARKET_SYNC_END"
  pnpm --filter api sync:commodity-continuous 20150105 "$EXTERNAL_MARKET_SYNC_END"
  COMMODITY_CONTINUOUS_COMPLETE="$(
    commodity_continuous_return_coverage "$DB_FILE" "$EXTERNAL_MARKET_SYNC_END"
  )"
  [[ "$COMMODITY_CONTINUOUS_COMPLETE" -eq 4 ]] || die "商品主力连续收益回填后仍不完整"
else
  log "商品主力连续收益与换月台账覆盖完整,跳过回填"
fi

WAREHOUSE_RECEIPT_SYNC_END="$(
  sqlite3 "$DB_FILE" 'SELECT max("tradeDate") FROM "Daily";' 2>/dev/null || true
)"
[[ "$WAREHOUSE_RECEIPT_SYNC_END" =~ ^[0-9]{8}$ ]] || die "无法确定商品仓单同步截止日"
WAREHOUSE_RECEIPT_COMPLETE="$(
  commodity_warehouse_receipt_coverage "$DB_FILE" "$WAREHOUSE_RECEIPT_SYNC_END"
)"
if [[ "$WAREHOUSE_RECEIPT_COMPLETE" -ne 4 ]]; then
  log "补全 AU/CU/SC/M 商品仓单研究底座: 20150101 ~ $WAREHOUSE_RECEIPT_SYNC_END"
  pnpm --filter api sync:commodity-warehouse-receipts 20150101 "$WAREHOUSE_RECEIPT_SYNC_END"
  WAREHOUSE_RECEIPT_COMPLETE="$(
    commodity_warehouse_receipt_coverage "$DB_FILE" "$WAREHOUSE_RECEIPT_SYNC_END"
  )"
  [[ "$WAREHOUSE_RECEIPT_COMPLETE" -eq 4 ]] || die "商品仓单历史回填后仍不完整"
else
  log "商品仓单历史覆盖完整,跳过回填"
fi

INVITE_COUNT="$(sqlite3 "$DB_FILE" 'SELECT count(*) FROM "InviteCode";' 2>/dev/null || echo 0)"
if [[ "$JIXIE_INVITES_EXPLICIT" -ne 1 && "${INVITE_COUNT:-0}" -gt 0 ]]; then
  log "邀请码已存在,跳过默认邀请码生成(如需补发,显式设 JIXIE_INVITES=N)"
elif [[ "$JIXIE_INVITES" -gt 0 ]]; then
  log "生成 $JIXIE_INVITES 个邀请码"
  pnpm --filter api gen:invite "$JIXIE_INVITES" "bootstrap" || warn "gen:invite 失败,可稍后手动补。"
fi

# ─────────────────────────────── 6. systemd 服务 ───────────────────────────────
log "安装 rootless systemd user 服务 jixie-sandboxd"
JIXIE_USER_UNIT_DIR="$JIXIE_DEPLOY_HOME/.config/systemd/user"
sudo install -d -m 0755 -o "$JIXIE_DEPLOY_USER" -g "$JIXIE_DEPLOY_USER" "$JIXIE_USER_UNIT_DIR"
sed -e "s#/opt/jixie#$JIXIE_DIR#g" \
    -e "s#/var/lib/jixie#$JIXIE_DATA_DIR#g" \
    "$JIXIE_DIR/deploy/jixie-sandboxd.service" | \
  sudo tee "$JIXIE_USER_UNIT_DIR/jixie-sandboxd.service" >/dev/null
sudo chown "$JIXIE_DEPLOY_USER:$JIXIE_DEPLOY_USER" \
  "$JIXIE_USER_UNIT_DIR/jixie-sandboxd.service"
sandbox_systemctl() {
  sudo -u "$JIXIE_DEPLOY_USER" env \
    XDG_RUNTIME_DIR="$JIXIE_USER_RUNTIME_DIR" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$JIXIE_USER_RUNTIME_DIR/bus" \
    systemctl --user "$@"
}
sandbox_systemctl daemon-reload
sandbox_systemctl enable jixie-sandboxd.service
if [[ "$DEPLOY_SANDBOXD" == "1" ]] || ! sandbox_systemctl is-active --quiet jixie-sandboxd.service; then
  sandbox_systemctl restart jixie-sandboxd.service
  sandbox_systemctl is-active --quiet jixie-sandboxd.service ||
    die "jixie-sandboxd 启动失败,请以 $JIXIE_DEPLOY_USER 运行 journalctl --user -u jixie-sandboxd -e"
fi

log "安装 systemd 服务 $JIXIE_SERVICE"
UNIT_DST="/etc/systemd/system/$JIXIE_SERVICE.service"
sed -e "s#/opt/jixie#$JIXIE_DIR#g" \
    -e "s#/var/lib/jixie#$JIXIE_DATA_DIR#g" \
    -e "s#^User=jixie#User=$JIXIE_DEPLOY_USER#" \
    -e "s#^Group=jixie#Group=$JIXIE_DEPLOY_USER#" \
    "$JIXIE_DIR/deploy/jixie-api.service" | sudo tee "$UNIT_DST" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$JIXIE_SERVICE"
if [[ "$DEPLOY_API" == "1" ]] || ! systemctl is-active --quiet "$JIXIE_SERVICE"; then
  sudo systemctl restart "$JIXIE_SERVICE"
  systemctl is-active --quiet "$JIXIE_SERVICE" ||
    die "$JIXIE_SERVICE 启动失败,查日志: journalctl -u $JIXIE_SERVICE -e"
  finish_deployment_gate done
else
  log "API 未受本次变更影响,保持运行"
fi

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
CURRENT_WATERMARK="$(
  sqlite3 "$DB_FILE" \
    "SELECT dailyPublishedThrough FROM \"MaintenanceState\" WHERE key = 'global';" \
    2>/dev/null ||
    true
)"
if [[ -n "$CURRENT_WATERMARK" ]]; then
  sudo systemctl enable --now \
    jixie-maintenance.timer \
    jixie-maintenance-weekly.timer
else
  sudo systemctl disable --now \
    jixie-maintenance.timer \
    jixie-maintenance-weekly.timer
fi

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
if [[ -z "$CURRENT_WATERMARK" ]]; then
  "$JIXIE_DIR/scripts/activate-maintenance.sh"
fi

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

REVISION_TEMP_FILE="$SUCCESSFUL_REVISION_FILE.tmp.$$"
printf '%s\n' "$CURRENT_REVISION" >"$REVISION_TEMP_FILE"
mv -- "$REVISION_TEMP_FILE" "$SUCCESSFUL_REVISION_FILE"

log "完成 ✅  访问: https://$JIXIE_DOMAIN  (若 TLS 未签发则 http://)"
cat <<EOF

以后安装、更新、迁移和资源补全都运行:
  cd $JIXIE_DIR && ./scripts/bootstrap.sh

定时任务: systemctl list-timers 'jixie-*'
EOF
