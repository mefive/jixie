# jixie 部署手记(VPS)

jixie 在 Linux VPS（Ubuntu / CentOS）上的部署。唯一入口是幂等的 `scripts/bootstrap.sh`：新机器安装
缺失资源，已有机器更新代码和 schema，空库自动执行可续传的全量行情导入。

> **一键从零**:`ssh` 登录 VPS → `cd /opt/jixie && ./scripts/bootstrap.sh`(首次没代码时先把脚本 scp 上去单独跑,它会自己 clone)。配置全走 env var,密钥可注入:
> ```bash
> JIXIE_DOMAIN=jixie.你的域名 TUSHARE_TOKEN=xxx RESEND_API_KEY=re_xxx \
> EMAIL_FROM=login@你的域名 DEEPSEEK_API_KEY=sk_xxx ./scripts/bootstrap.sh
> ```
> 脚本自动装齐依赖（Node.js、pnpm、nginx、certbot、sqlite3、Podman 和原生编译工具链）、clone/pull、迁移、
> 构建、空库行情导入、systemd、nginx、TLS、维护激活和冒烟测试。首次全量行情导入可能持续数小时；
> 中断后重新执行同一条 bootstrap 命令会根据数据库标记和导入阶段标记继续。
>
> 非密钥部署参数会持久化在 `/etc/jixie/bootstrap.env`。以后直接运行 bootstrap 会复用真实域名、
> 目录和服务名，不会退回模板域名。旧实例首次升级时会从当前启用的 Jixie Nginx vhost 自动识别
> 唯一真实域名；无法唯一识别时脚本会停止，此时只需带一次 `JIXIE_DOMAIN=真实域名` 重跑。

## 1. 服务器规格建议(jixie 比一般 web 吃资源)

- **内存**:回测/因子分析加载全市场面板 + 紧循环,单次可吃 1GB+;`vite build` 也偏吃内存。**建议 ≥2GB,推荐 4GB**,并配 **≥4GB swap**(<2GB 机器 `vite build` 易 OOM,可改为本机构建后 `rsync apps/web/dist`)。
- **磁盘**:行情库满配 **~6GB**;加备份轮转(每份=全库大小)很快吃满小盘。**建议 ≥40GB**；生产默认保留
  2 份，并应推离本机(见 §5)。
- **CPU**:回测是纯 CPU 计算,跑在 worker 线程里(不阻塞 HTTP);多核更好,单核也能跑,只是回测慢。
- **系统**:Ubuntu 22.04/24.04 或 CentOS/RHEL 8+;需普通 sudo 用户(服务以非 root 跑)。Python
  策略的 rootless Podman 资源限制要求宿主启用 cgroups v2，bootstrap 会检查并拒绝降级为无限制运行。

## 2. 隔离约定(与同机其它服务)

| 维度 | 值 |
|---|---|
| 代码 | `/opt/jixie` |
| 数据(prod.db) | `/var/lib/jixie/prod.db`(**在代码目录外,redeploy 不动**) |
| 端口 | `3001`(nginx 反代 `/api/` 到此) |
| service | `jixie-api`、`jixie-sandboxd`（Python 策略隔离运行时） |
| sandbox socket | `/var/lib/jixie/sandboxd.sock`（仅同组 API 可访问） |
| web | `apps/web/dist`，挂载 `/`，只包含登录和工作台 |
| docs | `apps/docs/dist/docs`，独立构建，挂载 `/docs/help/*` 和 `/docs/sdk` |

## 3. bootstrap 管理的资源

`bootstrap.sh` 自动检查并收敛系统依赖、代码版本、生产 env、Prisma Client 与 schema、前后端构建、
邀请码、systemd units、Nginx、TLS、行情初始化、发布水位和 timers。已有资源会复用或更新，缺失资源
会补建；不要再手工组合 API npm scripts 模拟一次部署。

Python 策略运行时由 bootstrap 以 `JIXIE_DEPLOY_USER` 构建为 rootless Podman 镜像
`jixie-python-runtime:py-v1`，再先启动 `jixie-sandboxd`、后启动 API。容器不挂载代码库或数据库，
不能访问网络，API 只通过 Unix socket 发送带长度头的协议帧。Python runtime 或 sandboxd 变更会把
API 一并纳入维护窗口，避免 API 连接到新旧不一致的协议版本。

`jixie-sandboxd` 是部署用户的 systemd **user service**，不是带 `User=` 的 system service。
bootstrap 会执行 `loginctl enable-linger`，使用户管理器和 sandboxd 在开机后、无人登录时仍运行；
这也是 rootless Podman 获取 cgroups v2 delegation、落实每容器资源限制的必要条件。

每次成功结束后，bootstrap 会把当前 Git revision 写入 `/var/lib/jixie/deployed-revision`。下次更新按
该 revision 到当前 revision 的完整差异自动选择 API、Web 和 Docs，多个范围取并集；共享包、依赖锁、
部署脚本或无法识别的新路径会保守地执行全量部署。只有 API 受影响时才进入部署维护状态、等待已有
`Job` / `AgentTurn` 结束、停止 API、生成 Prisma Client、构建、迁移并重启；纯 Web / Docs 更新不会
停止 API，静态产物在 staging 构建成功后原子切换。首次运行、部署记录缺失或记录无法验证时也会全量
执行。影响规则的机器可读真相源是 `deploy/component-impact.json`。

代码更新不会重复同步常规行情，行情增量仍由 maintenance timer 负责。`bootstrap.sh` 会单独检查官方
指数分类、34个市场气象指数、历史成分权重、派生指标和申万一级行业行情的历史覆盖；已有行情库升级后
缺少这组参考数据时，会按 `IndustryIndicator` 的可用区间自动执行参考数据、历史权重回填和市场状态
重算，覆盖完整后再次部署会跳过。

Nginx 主配置会 include 仓库中的 `/opt/jixie/deploy/nginx-docs-app.conf`，把独立构建的
`apps/docs/dist/docs` 挂载到 `/docs/` 并处理深链。脚本不会覆盖 Certbot 已写入的 TLS 配置。

从旧版配置升级且 vhost 已被 Certbot 改写时，需要做一次迁移：在 HTTPS server block 的
`root` / `index` 后加入下面一行，然后校验并 reload。不要重新覆盖整个 vhost，否则会丢失
Certbot 管理的 TLS 配置。

```nginx
include /opt/jixie/deploy/nginx-docs-app.conf;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> **排障提示 1**:api 的 `tsconfig` 用 `rootDir "."` 且 include 了 `scripts/`，因此 tsc 入口产物是
> `dist/src/index.js`；npm `start` 和 systemd 均已指向该路径。
>
> **排障提示 2**:prisma CLI 只读 `.env` 不读 `.env.production`。bootstrap 会自动维护软链，无需手工
> 处理。
>
> **排障提示 3**:`NODE_ENV=production` 使用 secure cookie，站点必须经 HTTPS 访问。
>
> **排障提示 4**:Python 策略依赖 rootless Podman。部署用户必须能直接执行 `podman info` 和
> `podman run`；若发行版没有为该用户配置 `/etc/subuid`、`/etc/subgid`，先按 Podman 文档分配互不
> 冲突的 subordinate ID range，并确认 `podman info --format '{{.Host.CgroupsVersion}}'` 输出 `v2`，
> 再重跑 bootstrap。不要把 sandboxd 改为 root 服务绕过此检查。
> `jixie-sandboxd.service` 必须作为 user service 并保留 `Delegate=yes`；没有有效 user session
> 和 cgroup delegation 时，rootless Podman 虽能启动普通容器，但会拒绝 CPU、内存和 PID 限额。

## 4. 行情数据初始化

bootstrap 检测到 `Daily` 为空时，会创建持久化的 `full-import.required` 标记并自动运行全量导入。导入
按年和阶段记录断点；任何阶段失败都会让 bootstrap 非零退出，重新执行 bootstrap 会继续，而不会把
部分数据发布为生产水位。

排障时可单独观察或重跑底层导入：

```bash
cd /opt/jixie
pnpm import:data
```

默认导入 2015 年至今的 A 股日线/复权、每日估值、涨跌停、资金流、龙虎榜、财务与分红、申万行业、
官方指数分类、风格指数与申万一级行业行情、主要 ETF、指数和股指期货。最终阶段先修复基线，再预计算
市场状态并执行严格数据审计。随后 bootstrap 启动 daily coordinator，由 daily 在同一维护状态机内验证
基线、建立连续发布水位并完成 catch-up。财务和分红阶段内部按股票分批启动短生命周期子进程，避免首次
导入也积累 Node/Prisma 原生内存；这不会增加新的部署命令。

> **研究史(用户、策略、因子、回测记录)不会生成或迁移**——Tushare 只提供市场数据，prod 从空库开始积累自己的研究。

### 之后：systemd 每日维护

`bootstrap.sh` 会安装三个 timer，并在 daily 成功建立或确认发布水位后启用：

```bash
systemctl list-timers 'jixie-*'
sudo systemctl start jixie-maintenance.service
journalctl -u jixie-maintenance.service -n 200 --no-pager
```

`jixie-maintenance.timer` 在工作日上海时间 22:30 尝试一次流水线。systemd 不识别交易所节假日，
因此休市工作日仍会唤醒 service；已有发布水位时，coordinator 刷新 SSE 交易日历后若没有历史缺口，
会在进入正常 daily 维护流程前成功退出，若有缺口则照常补齐。停机数日后由 coordinator 从连续水位
补齐所有缺失交易日，并在每次运行中回查水位前最近 5 个交易日。周任务回查
最近 252 个交易日；允许列表内的量价、复权、估值、涨跌停、资金流和主要指数缺口会自动重拉、复检并
按需重算 market-state。财务通过 VIP 按全部报告期核对，分红按全部股票核对，并用持久化 checkpoint
支持 OOM 或重启后续传；财务默认每 1 个报告期、分红默认每 200 只股票启动独立子进程，批次结束即释放
Node/Prisma 原生内存。不要再安装旧 cron，也不要在 API 内启动第二个 scheduler。
weekly 还会在市场派生数据完成后增量计算所有已钉住因子的月度气象点。首次钉住会由 API worker 回填
历史，部署本身不需要额外执行 factor sync；相关表由 Prisma migration 自动创建。
完整顺序、锁、维护 Gate 和手动修复见
[`production-maintenance.md`](./design/production-maintenance.md)。

## 5. 数据库备份

备份 timer 由 `bootstrap.sh` 安装，默认每天 03:00 用 SQLite 在线
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
./scripts/bootstrap.sh
```

脚本检查已有资源并跳过不需要的安装，拉取最新代码、按上次成功部署版本判断受影响组件、按需迁移和
构建，同时收敛 systemd/nginx、确认行情水位和 timer，再执行健康检查。若 bootstrap 自身在 pull 中
被更新，它会自动重新执行新版本脚本，用户无需再次运行。

## 7. 排障

- 服务日志:`journalctl -u jixie-api -f`
- API 状态:`systemctl status jixie-api`
- 沙箱状态（以部署用户执行）:`systemctl --user status jixie-sandboxd`
- 沙箱日志（以部署用户执行）:`journalctl --user -u jixie-sandboxd -f`
- rootless runtime:`podman info --format '{{.Host.Security.Rootless}}'` 应输出 `true`；镜像检查：
  `podman image exists jixie-python-runtime:py-v1`
- socket:`ss -xl | grep /var/lib/jixie/sandboxd.sock`
- 重启 sandbox（以部署用户执行）:`systemctl --user restart jixie-sandboxd`；随后
  `sudo systemctl restart jixie-api`
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
