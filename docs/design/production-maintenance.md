# 生产维护调度计划

> 状态：待实现。目标是把首次全量导入之后的增量数据维护、派生指标和备份变成可观测、可补跑、
> 不重复执行的生产任务。本文只定义实现计划，不代表当前生产机已经安装相应 timer。

## 1. 背景与现状

首次部署已有 `pnpm import:data`，可以从空库导入 2015 年至今的研究数据并预计算市场状态。
但它是一次性历史回填，不负责上线后的长期保鲜。

当前自动化边界：

- API 进程内的 `startSignalScheduler()` 在生产环境默认于上海时间
  `17:30 / 18:30 / 19:30` 运行；
- 每轮会同步交易日历、股票日线、复权因子、每日估值和涨跌停，再生成已部署策略的信号；
- 资金流、龙虎榜和 ETF 只在已部署策略确实依赖时同步；
- `MarketIndicator / IndexIndicator / IndustryIndicator` 只由
  `sync:market-state` 生成，当前每日信号调度不会更新它们；
- 财务、分红、股票名称历史、指数成分、指数估值、申万行业和完整 ETF/期货数据没有统一周期刷新；
- `jixie-backup.timer` 只有模板，bootstrap 不安装；service 模板还缺少生产库
  `JIXIE_DB_PATH=/var/lib/jixie/prod.db`，并把 `# EDIT` 写成了 directive 行尾注释。systemd unit
  不应依赖行尾注释语义，实现时要把说明移到独立注释行。

结果是：首次导入后系统能立即使用，但市场状态和慢频参考数据会逐渐停在旧日期，备份也不会自动发生。

## 2. 目标与非目标

### 目标

1. systemd 成为生产定时任务的唯一调度源，API 重启不影响计划任务。
2. 每个交易日自动刷新原始数据、验证完整性、生成派生指标和策略信号。
3. 同一天多时点重试时，失败可重试，成功后不重复计算或重复通知。
4. 慢频数据按周刷新，数据库每天在线备份。
5. 所有任务可手动补跑，有明确日志、状态和退出码。
6. 与 SQLite 单写入者约束相容，禁止维护任务重叠执行。

### 非目标

- 不把回测、因子分析、因子相关性和参数扫描改为定时任务；它们继续由用户操作触发 worker。
- 不在本计划中增加新的数据源或分钟级行情。
- 不把本地 VPS 备份误称为灾备；异地复制仍需单独实施。

## 3. 核心决策

### 3.1 systemd 是生产调度唯一真相源

生产 `.env.production` 固定：

```dotenv
SIGNALS_SCHEDULER_ENABLED=false
```

保留现有进程内 scheduler 作为开发/兼容入口，但生产不启用。否则 systemd 与 Node 进程可能同时同步、
重复占用 Tushare 配额，甚至重复生成通知。

### 3.2 每日维护统一成一条流水线

新增 CLI：

```bash
pnpm --filter api maintenance:daily [YYYYMMDD] [--force]
```

systemd 和人工补跑都调用同一入口。不要让 timer 拼接多个松散的 `pnpm sync:*` 命令，否则中途失败后
无法判断哪些阶段已完成，也无法保证信号只建立在完整数据上。

### 3.3 备份保持独立

备份使用独立的 `jixie-backup.service/.timer`。行情维护失败不能阻止备份，备份变慢也不能让收盘任务
错过时点。

## 4. 每日维护流水线

建议新增 `apps/api/src/maintenance/daily.ts` 和
`apps/api/scripts/run-daily-maintenance.ts`，按以下顺序执行：

1. **互斥锁**
   - 使用 `/var/lib/jixie/maintenance.lock` 的 `flock`，或等价的原子锁；
   - API 内的手动补跑也必须走同一锁；
   - 已有任务运行时，新任务明确退出并记录 `already_running`，不并发写 SQLite。

2. **确定目标日期**
   - 未传日期时按 `Asia/Shanghai` 取当天；
   - 同步 SSE 交易日历；
   - 非交易日以成功状态退出，不生成空信号。

3. **强制刷新当日密集表**
   - `Daily / AdjFactor / DailyBasic / StkLimit` 必须支持目标日 refresh；
   - 不能只用“该日期已有任意一行”判断完成：17:30 可能拿到部分数据，后续 18:30/19:30 必须能重抓；
   - 资金流、龙虎榜按已部署策略依赖刷新，同时可提供全量开关。

4. **完整性门禁**
   - `Daily` 目标日非空；
   - `AdjFactor` 与 `Daily` 的代码覆盖必须近乎一致；
   - `DailyBasic / StkLimit` 相对当日 `Daily`、最近交易日中位数的覆盖不能出现异常断崖；
   - 阈值必须先用现有生产数据测量后固化，不能凭空拍数；
   - 未过门禁则本轮失败，不生成信号，等待下一个时点重试。

5. **刷新每日扩展数据**
   - 主要指数 `IndexDaily / IndexDailyBasic`；
   - 主要 ETF 当日行情与复权，必须绕过已完成自然年分片的跳过逻辑；
   - 股指期货当日合约行情、主力映射和结算参数；
   - 所有写入保持按目标日幂等替换。

6. **生成派生市场状态**
   - 执行 `syncMarketIndicators(target, target)`；
   - 必须在股票、指数、行业成员输入完成后运行；
   - 验证三张派生表的最大日期和行数。

7. **生成每日信号**
   - 从现有 `runDailySignalCycle` 抽出“只生成信号、不再同步”的函数；
   - 维护流水线完成一次同步后调用该函数，避免第二遍抓数据；
   - `SignalRun` 保持现有幂等约束，通知只在最终结果首次提交后发送。

8. **记录结果**
   - 成功记录各表目标日行数、部署数、成功/失败信号数和耗时；
   - 失败记录具体 stage 和错误，进程返回非零；
   - systemd journal 中每行使用固定前缀 `[maintenance]`。

## 5. 幂等与运行状态

建议新增 `MaintenanceRun` model，不依赖内存状态：

- `kind`：`daily | weekly`；
- `targetDate`；
- `status`：`running | done | error`；
- `stage`；
- `attempts`；
- `summary` JSON；
- `error`；
- `startedAt / finishedAt`；
- `@@unique([kind, targetDate])`。

同一天第一个时点成功后，后续时点看到 `done` 直接退出。失败时增加 attempts 并从安全边界重跑；
由于每个同步阶段本身幂等，不要求从任意 SQL 语句中间恢复。`--force` 只供人工纠错使用，并在日志中
显式标记。

该表是运维数据，不加入 agent 只读 SQL 白名单。

## 6. systemd 单元

新增：

```text
deploy/jixie-maintenance.service
deploy/jixie-maintenance.timer
```

service 关键配置：

- `User=ubuntu` 由 bootstrap 按 `JIXIE_DEPLOY_USER` 渲染，禁止 root 跑业务脚本；
- `WorkingDirectory=/opt/jixie/apps/api`；
- `EnvironmentFile=/opt/jixie/apps/api/.env.production`；
- `ExecStart=/usr/bin/env pnpm maintenance:daily`，或使用解析出的 pnpm 绝对路径；
- `ReadWritePaths=/var/lib/jixie`；
- `Nice=10`，降低维护任务对交互请求的 CPU 竞争；
- `TimeoutStartSec` 按实测设置，不能使用默认 90 秒；
- 日志进入 journald。

timer 使用三个重试时点：

```ini
OnCalendar=Mon..Fri *-*-* 17:30:00 Asia/Shanghai
OnCalendar=Mon..Fri *-*-* 18:30:00 Asia/Shanghai
OnCalendar=Mon..Fri *-*-* 19:30:00 Asia/Shanghai
Persistent=true
```

实现时用 `systemd-analyze calendar` 验证目标机器支持的时区语法；若版本不支持行内时区，使用
`Environment=TZ=Asia/Shanghai` 或统一服务器时区，并在验收中核对下一次触发时间。

bootstrap 只负责渲染并安装单元，首次全量导入完成前不自动 enable。提供显式安装命令：

```bash
sudo ./scripts/install-maintenance.sh
```

安装脚本必须验证：

- `.env.production` 存在；
- `DATABASE_URL` 指向生产库；
- `SIGNALS_SCHEDULER_ENABLED=false`；
- 全量导入已经完成；
- timer 与 service 通过 `systemd-analyze verify`。

## 7. 慢频刷新

每日链路稳定后再新增：

```text
jixie-maintenance-weekly.service
jixie-maintenance-weekly.timer
```

建议周日凌晨执行，复用：

```bash
pnpm --filter api maintenance:weekly
```

| 数据 | 频率 | 实现前需要补的能力 |
|---|---:|---|
| StockBasic / 名称历史 | 每周 | 现有全量替换可复用 |
| FinaIndicator | 每周 | 新增真正的增量/全量刷新模式；现有“已同步股票跳过”不能获取新财报 |
| Dividend | 每周 | 支持按近期公告或受影响股票刷新，避免每周无条件拉全市场 |
| IndexWeight | 每周 | 只刷新当前季度，并保留历史快照 |
| SW 行业成员 | 每周或每月 | 现有小表全量替换可复用 |
| ETF 元数据 | 每周 | 元数据全量刷新；日线由 daily 负责 |
| FutureContract | 每周 | 合约元数据全量刷新；日线由 daily 负责 |

周任务与日任务共享同一个锁。不要在第一阶段直接把所有现有 sync 命令塞进 cron；部分命令的
“断点续传”语义会永久跳过已有股票，不能承担增量保鲜。

## 8. 备份

修复并安装现有备份单元：

```ini
Environment=JIXIE_DB_PATH=/var/lib/jixie/prod.db
Environment=JIXIE_BACKUP_DIR=/var/backups/jixie
Environment=JIXIE_BACKUP_KEEP=2
```

同时移除 `User=`、`Environment=`、`ExecStart=` directive 后的行尾 `# EDIT`，把说明改成独立注释
行。bootstrap 或安装脚本需要创建目录并赋予 deploy user。timer 每天 03:00 运行，首次启用时立即
手动触发一次并做恢复演练。VPS 单盘备份只防误操作，不防实例/磁盘整体损坏；后续另加异地复制。

## 9. 观测与排障

必须提供并写入部署文档：

```bash
systemctl list-timers 'jixie-*'
systemctl status jixie-maintenance.service
journalctl -u jixie-maintenance.service -n 200 --no-pager
sudo systemctl start jixie-maintenance.service
pnpm --filter api maintenance:daily 20260729 --force
```

最低告警方案：

- timer/service 失败可从腾讯云主机监控或外部 uptime 监控发现；
- 数据接口展示最新原始行情日期与最新 `MarketIndicator` 日期；
- 两者落后最近交易日时在页面或日志明确告警；
- 不把“systemd service 退出 0”当作唯一成功标准，必须检查完整性门禁和派生表日期。

## 10. 实施阶段

### Phase A：每日维护

1. 给当日密集同步增加 refresh 能力与完整性检查。
2. 抽出信号生成函数，消除“维护同步一次、信号再同步一次”。
3. 新增 `MaintenanceRun` migration、daily pipeline 和 CLI。
4. 新增 systemd service/timer 和安装脚本。
5. 生产关闭进程内 scheduler，手动运行 daily service 验收后再 enable timer。

### Phase B：备份

1. 修复生产 DB 路径。
2. 渲染 deploy user、路径和保留份数。
3. 安装 timer、立即备份、验证副本可读。
4. 记录一次停服恢复演练。

### Phase C：慢频刷新

1. 为财务、分红、指数成分等实现真正的增量刷新语义。
2. 新增 weekly CLI/service/timer。
3. 用数据最大日期和公告日期验收，而不是只看命令退出码。

### Phase D：异地备份与告警

1. 将最新备份推到独立存储。
2. 增加定时任务失败和数据日期滞后的外部告警。

## 11. 测试与验收

### 自动测试

- 非交易日成功空跑；
- 17:30 部分数据失败、18:30 refresh 后成功；
- 完整性未过时绝不生成信号；
- 同日成功后再次触发不重复通知；
- `--force` 可重跑且不产生重复 `SignalRun`；
- market-state 三张表只替换目标日期；
- daily 与 weekly 互斥；
- API 重启不影响 timer；
- `systemd-analyze verify` 通过。

### 生产验收

1. 首次全量导入和数据审计通过。
2. 手动启动 maintenance service，journal 明确展示每个 stage。
3. 原始行情与三张 market-state 表最大日期一致。
4. 有部署策略时只产生一份当日 `SignalRun` 和一封通知。
5. 次日重启 API 后 timer 仍存在且下一触发时间正确。
6. backup timer 生成可读副本，源路径明确为 `/var/lib/jixie/prod.db`。
7. 连续观察至少三个交易日，再删除或废弃生产进程内 scheduler 路径。

## 12. 完成定义

以下条件全部满足才算生产维护闭环完成：

- `systemctl list-timers 'jixie-*'` 能看到 daily 与 backup；
- 生产 env 明确关闭进程内 scheduler；
- 最近交易日原始数据、派生市场状态和信号运行日期一致；
- 失败可在下一时点自动补跑，成功不会重复通知；
- 每日备份目标是生产库且已做恢复验证；
- 部署文档包含安装、手动补跑、日志和恢复步骤。
