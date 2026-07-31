# jixie 部署手记(VPS)

jixie 在 Linux VPS(Ubuntu / CentOS)上的部署。配套产物:`scripts/bootstrap.sh`(一键从零,幂等)、`scripts/deploy.sh`(日常更新)、`deploy/jixie-api.service`、`deploy/nginx-jixie.conf`、`apps/api/.env.production.example`。

> **一键从零**:`ssh` 登录 VPS → `cd /opt/jixie && ./scripts/bootstrap.sh`(首次没代码时先把脚本 scp 上去单独跑,它会自己 clone)。配置全走 env var,密钥可注入:
> ```bash
> JIXIE_DOMAIN=jixie.你的域名 TUSHARE_TOKEN=xxx RESEND_API_KEY=re_xxx \
> EMAIL_FROM=login@你的域名 DEEPSEEK_API_KEY=sk_xxx ./scripts/bootstrap.sh
> ```
> 脚本自动装齐依赖(node22 / pnpm / nginx / certbot / sqlite3;2026-07-07 起要求 **Node ≥22.13**——只读 SQL worker 用 node:sqlite;isolated-vm 硬沙箱是原生模块,需 C++ 工具链——重跑 bootstrap 一并装齐并升级)、clone/pull、建库 schema、构建、装 systemd+nginx、尝试 certbot、冒烟测试。**它不碰行情数据**——建的是空库,数据要另外回填(见 §4)。

## 1. 服务器规格建议(jixie 比一般 web 吃资源)

- **内存**:回测/因子分析加载全市场面板 + 紧循环,单次可吃 1GB+;`vite build` 也偏吃内存。**建议 ≥2GB,推荐 4GB**,并配 **≥4GB swap**(<2GB 机器 `vite build` 易 OOM,可改为本机构建后 `rsync apps/web/dist`)。
- **磁盘**:行情库满配 **~6GB**;加备份轮转(每份=全库大小)很快吃满小盘。**建议 ≥40GB**；生产默认保留
  2 份，并应推离本机(见 §5)。
- **CPU**:回测是纯 CPU 计算,跑在 worker 线程里(不阻塞 HTTP);多核更好,单核也能跑,只是回测慢。
- **系统**:Ubuntu 22.04/24.04 或 CentOS/RHEL 8+;需普通 sudo 用户(服务以非 root 跑)。

## 2. 隔离约定(与同机其它服务)

| 维度 | 值 |
|---|---|
| 代码 | `/opt/jixie` |
| 数据(prod.db) | `/var/lib/jixie/prod.db`(**在代码目录外,redeploy 不动**) |
| 端口 | `3001`(nginx 反代 `/api/` 到此) |
| service | `jixie-api` |
| web | `apps/web/dist`，挂载 `/`，只包含登录和工作台 |
| docs | `apps/docs/dist/docs`，独立构建，挂载 `/docs/help/*` 和 `/docs/sdk` |

## 3. 一次性初始化(bootstrap 的人工展开版)

`bootstrap.sh` 已把下面全部脚本化;这里是背景说明,排障时对照。

```bash
# 3.1 拉代码 + 数据目录
sudo mkdir -p /opt/jixie && sudo chown $USER:$USER /opt/jixie
git clone https://github.com/mefive/jixie.git /opt/jixie && cd /opt/jixie
sudo mkdir -p /var/lib/jixie && sudo chown $USER:$USER /var/lib/jixie

# 3.2 env(填真实值:TUSHARE_TOKEN 必填,否则 app 拒绝启动)
cp apps/api/.env.production.example apps/api/.env.production
$EDITOR apps/api/.env.production
chmod 600 apps/api/.env.production
ln -sf .env.production apps/api/.env   # prisma CLI / sync / gen:invite 读 .env

# 3.3 安装 / 迁移(空库 schema)/ 构建 / 邀请码
pnpm install --frozen-lockfile
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate deploy
pnpm -r build
pnpm --filter api gen:invite 1 "首批"

# 3.4 systemd(注意 ExecStart 指向 dist/src/index.js —— tsc rootDir "." 的产物路径)
sudo cp deploy/jixie-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now jixie-api
curl -s localhost:3001/api/health    # {"ok":true}

# 3.5 nginx + 证书
sudo cp deploy/nginx-jixie.conf /etc/nginx/sites-available/jixie.你的域名
sudo ln -s /etc/nginx/sites-available/jixie.你的域名 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d jixie.你的域名
```

`nginx-jixie.conf` 会在 server block 内 include 仓库中的
`/opt/jixie/deploy/nginx-docs-app.conf`。该文件把独立构建的 `apps/docs/dist/docs` 挂载到
`/docs/`，并处理文档深链。只更新文档静态产物时不需要 reload Nginx；完整部署会校验并
reload Nginx，以便仓库内的 Nginx include 配置变更生效。脚本不会覆盖 Certbot 写入主
vhost 的证书配置。

从旧版配置升级且 vhost 已被 Certbot 改写时，需要做一次迁移：在 HTTPS server block 的
`root` / `index` 后加入下面一行，然后校验并 reload。不要重新覆盖整个 vhost，否则会丢失
Certbot 管理的 TLS 配置。

```nginx
include /opt/jixie/deploy/nginx-docs-app.conf;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> **坑 1(与 fangtu 同)**:api 的 `tsconfig` 用 `rootDir "."` 且 include 了 `scripts/`,tsc 产物是 **`dist/src/index.js`**(不是 `dist/index.js`)。systemd `ExecStart` 已据此指向 `dist/src/index.js`;`apps/api` 的 `start` 脚本仍写 `dist/index.js` 是历史小 bug,不影响(systemd 用绝对路径)。
> **坑 2**:prisma CLI 只读 `.env` 不读 `.env.production` → 用 `ln -sf .env.production .env`(bootstrap 已做),否则 `migrate deploy`/`sync` 找不到 `DATABASE_URL`。
> **坑 3**:`NODE_ENV=production` 用 **secure(仅 HTTPS)cookie**。**站点必须走 HTTPS 否则登录不保持**——certbot 签证书,或前置 Cloudflare/其它 TLS。纯 HTTP 只能开发用。

## 4. 行情数据回填(⭐ jixie 特有,bootstrap 不做)

行情库 ~6GB、不可快速重建。两条路径,按你的取舍:

### A. VPS 自己同步(默认;不搬大文件、prod 库干净)

限频 400ms/次(~150 call/min),**首轮全量按年断点续传,后台跑**(数小时~1 天级,取决于 Tushare 积分档)。已有 `.env` 软链后，运行全量导入脚本：

```bash
cd /opt/jixie
sudo systemctl stop jixie-api
nohup pnpm import:data > /var/lib/jixie/full-import.log 2>&1 &
tail -f /var/lib/jixie/full-import.log
# 全部完成后
sudo systemctl start jixie-api
```

默认导入 2015 年至今的 A 股日线/复权、每日估值、涨跌停、资金流、龙虎榜、财务与分红、申万行业、主要 ETF、指数、股指期货。最终阶段会先自动检查并修复最近 20 个已完成交易日的确定性密集切片缺口，再预计算市场状态、执行严格数据审计并初始化连续发布水位；任一步失败都不会启用残缺基线。股票名称历史和指数基准会按各自更早的数据起点导入。脚本把完成阶段记录在 `.jixie-import/<start>-<end>`，失败或 SSH 断线后重新执行同一命令即可续传。显式日期范围用 `pnpm import:data 20150101 20260729`；需要忽略完成标记时设置 `JIXIE_IMPORT_IGNORE_STATE=1`。

> **研究史(用户、策略、因子、回测记录)不会生成或迁移**——Tushare 只提供市场数据，prod 从空库开始积累自己的研究。

### B. 从本机传库(最快;带研究史)

想立刻能用、且要把本机的研究史一起带上:

```bash
# 本机:先做一份一致的 checkpoint 副本(别直接 cp WAL 库)
pnpm --filter api backup                       # 生成 ~/jixie-backups/dev-*.db

# 传到 VPS(停服 → 替换 → 起服)
ssh vps 'sudo systemctl stop jixie-api'
rsync -avP ~/jixie-backups/dev-YYYYMMDD-HHMMSS.db vps:/var/lib/jixie/prod.db
ssh vps 'sudo systemctl start jixie-api'
```

> ~6GB(gzip 后约 3-4GB)一次传输。之后 VPS 仍需每日增量同步保鲜(§5)。

### 之后：systemd 每日维护

全量导入脚本会在基线自愈和严格审计通过后初始化 `dailyPublishedThrough`。`bootstrap.sh` 和
`deploy.sh api|all` 会安装三个 timer：

```bash
systemctl list-timers 'jixie-*'
sudo systemctl start jixie-maintenance.service
journalctl -u jixie-maintenance.service -n 200 --no-pager
```

`jixie-maintenance.timer` 在工作日上海时间 17:30、18:30、19:30 尝试同一流水线；停机数日后由
coordinator 从连续水位补齐所有缺失交易日，并在每次运行中回查水位前最近 5 个交易日。周任务回查
最近 252 个交易日；允许列表内的量价、复权、估值、涨跌停、资金流和主要指数缺口会自动重拉、复检并
按需重算 market-state。不要再安装旧 cron，也不要在 API 内启动第二个 scheduler。
完整顺序、锁、维护 Gate 和手动修复见
[`production-maintenance.md`](./design/production-maintenance.md)。

首次把 maintenance migration 部署到已有行情库时，先不要启动 daily/weekly timer，然后用激活脚本
完成锁、基线初始化、API 重启和 timer 启用：

```bash
JIXIE_ENABLE_MAINTENANCE_TIMERS=0 ./scripts/deploy.sh all
./scripts/activate-maintenance.sh
```

全新机器运行 `bootstrap.sh` 时，如果数据库还是空的，脚本只启用 backup timer；完成
`pnpm import:data` 后运行一次 `./scripts/activate-maintenance.sh`。激活脚本内部的
`maintenance:init` 会先自愈并验证最近基线，再初始化 `dailyPublishedThrough`。之后的常规发布直接
运行 `./scripts/deploy.sh all`；已有水位不会被重置。

## 5. 数据库备份

备份 timer 也由 `bootstrap.sh` / `deploy.sh api|all` 安装，默认每天 03:00 用 SQLite 在线
`.backup` 生成一致快照，校验成功后只保留最新 2 份：

```bash
sudo systemctl start jixie-backup.service
systemctl status jixie-backup.service
journalctl -u jixie-backup.service -n 100 --no-pager
ls -lh /var/backups/jixie
```

自定义目录可在部署时设置 `JIXIE_BACKUP_DIR`；调整保留数时修改渲染后的
`/etc/systemd/system/jixie-backup.service` 中 `JIXIE_BACKUP_KEEP`，再执行
`sudo systemctl daemon-reload`。

> ⚠ **VPS 单盘本地备份 = 没备份**。真正的持久化是把备份目录**推离本机**:`rsync` 到另一台 / 对象存储 / litestream。行情可重同步、研究史不可重建,后者尤其要异地。

## 6. 日常更新

```bash
ssh vps
cd /opt/jixie
./scripts/deploy.sh          # 默认 all，保持原有完整部署行为
./scripts/deploy.sh docs     # 只构建 shared + docs，不迁移、不 reload Nginx、不重启 API
./scripts/deploy.sh web      # 只构建 shared + web
./scripts/deploy.sh api      # 只构建 shared + API、执行迁移并重启 API
```

每次只能指定一个目标：`all`、`api`、`web` 或 `docs`。所有目标都会先检查部署目录、Git
分支/upstream、tracked worktree 是否干净、Node 版本和必需命令，再执行
`git pull --ff-only` 与 `pnpm install --frozen-lockfile`。这是有意保留的前置步骤：即使只改
docs，也可能同时改了 lockfile 或 `@jixie/shared`。

脚本用文件锁阻止并发部署；`web` / `docs` 会先在临时目录完成 typecheck 和构建，确认有
`index.html` 并把静态目录调整为 Nginx 可读后，再替换线上目录。重复执行同一命令是安全的；
若静态产物切换被中断，下次执行会先恢复或清理上一次的切换状态。

## 7. 排障

- 服务日志:`journalctl -u jixie-api -f`
- 服务状态:`systemctl status jixie-api` / `sudo systemctl restart jixie-api`
- 端口:`ss -tlnp | grep 3001`
- 健康:`curl -s localhost:3001/api/health` → `{"ok":true}`
- nginx:`sudo nginx -t`、`/var/log/nginx/error.log`
- 维护进度：`journalctl -u jixie-maintenance.service -f`；库行数：
  `sqlite3 /var/lib/jixie/prod.db 'SELECT count(*) FROM "Daily";'`

## 8. 注意事项

- **TUSHARE_TOKEN 必填**:不填 app 直接抛错拒绝启动(`config.ts`)。
- **HTTPS 必需**:生产 secure cookie,纯 HTTP 登录不保持。
- **登录靠邮件**:生产无 console 验证码兜底,`RESEND_API_KEY` + 已验证的 `EMAIL_FROM` 域名必须配好,否则没人能登录。
- **内存/磁盘**:见 §1;回测与 `vite build` 别在紧内存机器上同时跑。
- **私有仓库 clone**:VPS 需 GitHub 访问凭据(SSH key / deploy token),否则 `git clone` 失败。
