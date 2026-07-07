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
- **磁盘**:行情库满配 **~6GB**;加备份轮转(每份=全库大小)很快吃满小盘。**建议 ≥40GB**,并把备份 `JIXIE_BACKUP_KEEP` 调小(2~3)或推离本机(见 §6)。
- **CPU**:回测是纯 CPU 计算,跑在 worker 线程里(不阻塞 HTTP);多核更好,单核也能跑,只是回测慢。
- **系统**:Ubuntu 22.04/24.04 或 CentOS/RHEL 8+;需普通 sudo 用户(服务以非 root 跑)。

## 2. 隔离约定(与同机其它服务)

| 维度 | 值 |
|---|---|
| 代码 | `/opt/jixie` |
| 数据(prod.db) | `/var/lib/jixie/prod.db`(**在代码目录外,redeploy 不动**) |
| 端口 | `3001`(nginx 反代 `/api/` 到此) |
| service | `jixie-api` |
| web | 根路径 `/`(Vite dist,普通 `build`,无 BASE_PATH) |

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

> **坑 1(与 fangtu 同)**:api 的 `tsconfig` 用 `rootDir "."` 且 include 了 `scripts/`,tsc 产物是 **`dist/src/index.js`**(不是 `dist/index.js`)。systemd `ExecStart` 已据此指向 `dist/src/index.js`;`apps/api` 的 `start` 脚本仍写 `dist/index.js` 是历史小 bug,不影响(systemd 用绝对路径)。
> **坑 2**:prisma CLI 只读 `.env` 不读 `.env.production` → 用 `ln -sf .env.production .env`(bootstrap 已做),否则 `migrate deploy`/`sync` 找不到 `DATABASE_URL`。
> **坑 3**:`NODE_ENV=production` 用 **secure(仅 HTTPS)cookie**。**站点必须走 HTTPS 否则登录不保持**——certbot 签证书,或前置 Cloudflare/其它 TLS。纯 HTTP 只能开发用。

## 4. 行情数据回填(⭐ jixie 特有,bootstrap 不做)

行情库 ~6GB、不可快速重建。两条路径,按你的取舍:

### A. VPS 自己同步(默认;不搬大文件、prod 库干净)

限频 400ms/次(~150 call/min),**首轮全量按年断点续传,后台跑**(数小时~1 天级,取决于 Tushare 积分档)。已有 `.env` 软链后:

```bash
cd /opt/jixie
# daily / adj_factor / daily_basic —— 逐年拉(可断点续,失败重跑该年即可)
for y in 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025; do
  pnpm --filter api sync ${y}0101 ${y}1231
done
# 涨跌停 / 资金流 / 龙虎榜(现覆盖 2020+,按需往前扩)
pnpm --filter api sync:limit     20200101 20241231
pnpm --filter api sync:moneyflow 20200101 20241231
pnpm --filter api sync:toplist   20200101 20241231
# 财务 / 指数(沪深300 等基准)
pnpm --filter api sync:fina
pnpm --filter api sync:index
```

> 用 `nohup ... &` 或 `tmux`/`screen` 跑,别让 ssh 断开中断。**研究史(策略/因子/回测记录)不会来**——Tushare 只给行情,prod 从空开始积累自己的研究。

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

### 之后:每日增量同步(保鲜,信号线的前置)

历史回填完,每天收盘后补当天一根(为将来的每日信号做准备)。cron 一行:

```cron
30 18 * * 1-5  cd /opt/jixie && pnpm --filter api sync $(date +\%Y\%m\%d) $(date +\%Y\%m\%d) >> /var/log/jixie-sync.log 2>&1
```

> 交易日 17:00-18:00 后 Tushare 出当日数据;非交易日 sync 空跑无害。这块将来由主线五「每日信号」正式接管(自动同步 + 出信号)。

## 5. 数据库备份(见 ROADMAP 4.6)

`scripts/backup-db.mjs` + systemd timer 已就绪。VPS 上:

```bash
sudo cp apps/api/scripts/jixie-backup.service apps/api/scripts/jixie-backup.timer /etc/systemd/system/
# 编辑 .service:User=、JIXIE_BACKUP_DIR=/var/backups/jixie、ExecStart 路径、JIXIE_BACKUP_KEEP(小盘调 2~3)
sudo systemctl daemon-reload && sudo systemctl enable --now jixie-backup.timer
```

> ⚠ **VPS 单盘本地备份 = 没备份**。真正的持久化是把备份目录**推离本机**:`rsync` 到另一台 / 对象存储 / litestream。行情可重同步、研究史不可重建,后者尤其要异地。

## 6. 日常更新

```bash
ssh vps
cd /opt/jixie && ./scripts/deploy.sh    # git pull -> install -> migrate deploy -> build -> restart
```

## 7. 排障

- 服务日志:`journalctl -u jixie-api -f`
- 服务状态:`systemctl status jixie-api` / `sudo systemctl restart jixie-api`
- 端口:`ss -tlnp | grep 3001`
- 健康:`curl -s localhost:3001/api/health` → `{"ok":true}`
- nginx:`sudo nginx -t`、`/var/log/nginx/error.log`
- 同步进度:`tail -f /var/log/jixie-sync.log`;库行数 `sqlite3 /var/lib/jixie/prod.db 'SELECT count(*) FROM "Daily";'`

## 8. 注意事项

- **TUSHARE_TOKEN 必填**:不填 app 直接抛错拒绝启动(`config.ts`)。
- **HTTPS 必需**:生产 secure cookie,纯 HTTP 登录不保持。
- **登录靠邮件**:生产无 console 验证码兜底,`RESEND_API_KEY` + 已验证的 `EMAIL_FROM` 域名必须配好,否则没人能登录。
- **内存/磁盘**:见 §1;回测与 `vite build` 别在紧内存机器上同时跑。
- **私有仓库 clone**:VPS 需 GitHub 访问凭据(SSH key / deploy token),否则 `git clone` 失败。
