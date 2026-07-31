# 生产维护与调度设计

> 状态：代码已实现，待生产验收。本文同时记录已落地行为和生产启用步骤。仓库中的 service、timer、
> CLI、状态表和前端 Gate 已可用，但仍需部署到目标机器、初始化发布水位并按第 13 节验收后，才能认为
> 生产定时维护已经启用。

## 1. 目标与边界

### 1.1 目标

1. systemd 是生产定时任务的唯一调度源，API 重启或横向扩容不会重复触发维护。
2. 每个交易日按固定顺序刷新原始数据、验证完整性、生成派生市场状态和策略信号。
3. 同一天多时点重试时，失败可重试，成功后不重复同步、计算或通知。
4. 每周刷新财务、分红、成分和元数据等慢频资料。
5. 每天对 SQLite 做在线备份，备份与行情维护相互独立。
6. 所有维护任务都有受保护的手动入口、明确日志、持久化状态和非零失败退出码。
7. 维护期间 App 不读取跨表更新到一半的数据，也不启动新的回测、因子分析或手动信号任务。

### 1.2 非目标

- 回测、因子分析、因子相关性和参数扫描仍由用户触发，不改成定时任务。
- 不在本设计中新增数据源或分钟级行情。
- 不把 VPS 本机备份称为灾备；异地复制需要单独实施。
- 不用 Redis 或进程内缓存承担维护互斥。当前部署是单机 systemd + 单个 SQLite 文件，操作系统文件
  锁更直接可靠。

## 2. 维护任务总览

所有时间均为 `Asia/Shanghai`。

| 任务 | systemd timer | 默认时间 | 内容 | 是否进入维护模式 | 手动入口 |
|---|---|---:|---|---|---|
| 每日维护 | `jixie-maintenance.timer` | 交易日 `17:30 / 18:30 / 19:30` | 补齐缺失日、回查近期已发布日、完整性门禁、市场状态、最新信号 | 是 | `systemctl start jixie-maintenance.service` |
| 每周维护 | `jixie-maintenance-weekly.timer` | 周日 `04:30` | 慢频资料、最近一年已发布日自愈、代码身份收敛、深度审计和历史重算 | 是 | `systemctl start jixie-maintenance-weekly.service` |
| 数据库备份 | `jixie-backup.timer` | 每天 `03:00` | SQLite 在线备份、校验、轮转 | 否 | `systemctl start jixie-backup.service` |
| 历史修复 | 无 | 人工决定 | 指定日期或区间重新同步、审计并重算市场状态 | 是 | 受锁保护的 maintenance CLI |

每日三个时点不是三份任务，而是同一数据截止日的三个尝试：

- 数据流水线第一次成功后，后续时点不再同步原始数据或重算 market-state；
- 若仍有失败或 stale 的 `SignalRun`，后续时点只重试这些信号；全部终态成功时才直接退出；
- 17:30 数据不完整时，本次失败且不发布残缺快照；
- 18:30、19:30 对目标日强制重新拉取并再次验证；
- 三次均失败时保留上一个成功数据截止日，记录错误并告警，不生成当日信号。

服务器或 timer 停止数日后，恢复时不能只同步恢复当天。daily service 必须从连续发布水位开始，枚举到
最近已收盘交易日之间的全部 SSE 开市日并按日期升序补齐。systemd 只负责恢复后唤醒一次，具体缺口由
maintenance CLI 发现和处理。

备份独立于 daily/weekly：行情维护失败不能阻止备份，备份变慢也不能让收盘任务错过时点。备份使用
SQLite 在线 `.backup`，不切换 App 维护模式；如果实测磁盘竞争明显，再调整执行时间。

### 2.1 跨任务依赖

- daily 与 weekly 没有“同一天必须先后成功”的业务依赖，但它们会写同一个 SQLite，必须通过共享文件
  锁串行。
- daily 使用不晚于目标日的最新有效 `IndexWeight` PIT 快照，以及 `inDate <= 目标日 <
  outDate` 的 `SwIndustryMember` 成员关系，不要求当天刷新成分。当前门禁要求每个约定指数都有快照，
  且指数权重快照默认不老于 190 个自然日（可用 `MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS` 调整）；
  申万成员关系按生效区间判断，并要求至少 20 个有效一级行业。
- weekly 若修订了历史成分、行业成员或复权因子，必须在同一周任务内重算受影响区间的 market-state，
  不能等下一次 daily 只计算最新一天。
- `canonicalize:stock-codes` 和 `audit:data` 不单独创建 timer。代码身份收敛与审计必须在持有同一维护锁
  的 daily、weekly 或 repair pipeline 内执行，避免审计结束后另一任务又改库的竞态。
- daily 默认回查水位前 5 个交易日；weekly 默认回查水位前 252 个交易日。只自动修复可确定重拉语义
  的 `Daily / AdjFactor / DailyBasic / StkLimit / Moneyflow / TopList / IndexDaily /
  IndexDailyBasic` 日期切片，修复后重新执行原始门禁；核心量价或指数变化还会从最早影响日重算
  market-state。PIT 成分缺失、未知代码继承和内容冲突不猜测，继续作为硬错误。
- backup 与 daily/weekly 没有数据顺序依赖，可以在线并行；默认排在周任务之前只是为了降低磁盘竞争。
- repair 与 daily/weekly 共用文件锁。repair 完成前不得启动另一种维护，也不得在修复到一半时开放 App。

### 2.2 当前实现边界

截至 2026-07-31，daily/weekly/repair coordinator、状态表、API Gate、前端 `PollingModel`、systemd
单元、部署安装和备份轮转均已落地，API 内置定时器已删除。仍需注意：

- weekly 当前对财务指标和分红执行全股票强制刷新，正确但较慢；后续可在同步函数能可靠报告受影响股票
  和日期后改为增量；
- weekly 当前刷新最近六个月的指数权重，并回查最近 252 个交易日的密集行情切片；发现核心量价、
  资金流或主要指数缺口时按日期幂等重拉，并对代码、成分、行业成员、核心量价或指数变化重算
  market-state；
- `StockCodeChange` 只能收敛已登记映射，新的证券代码继承关系仍必须人工核实、登记并 repair；
- 本机仅保留两个 SQLite 备份，还没有异地复制和外部告警；
- `systemd-analyze verify/calendar`、真实 Tushare 配额耗时、一次恢复演练和连续三个交易日观察必须在
  目标生产机完成。

## 3. 调度唯一来源

### 3.1 生产只使用 systemd

API 启动时的 `startSignalScheduler()` 和 `setInterval` 已删除。保留可复用的信号业务函数与 CLI，
不保留第二个生产调度器。

生产切换按以下顺序：

1. 实现 daily pipeline、状态表、维护 Gate 和 systemd 单元；
2. 全量导入先执行 `maintenance:heal-baseline` 修复最近基线切片，再生成 market-state、通过严格审计并
   执行 `maintenance:init`；
3. 手动运行 daily service 验收；
4. enable systemd timer，连续观察至少三个交易日。

不能长期保留一个“默认关闭”的内置 scheduler。误配环境变量、多 API 实例或滚动重启都可能让它与
systemd 同时运行，重复消耗 Tushare 配额并争抢 SQLite 写锁。

### 3.2 systemd timer

每日 timer：

```ini
[Timer]
OnCalendar=Mon..Fri *-*-* 17:30:00 Asia/Shanghai
OnCalendar=Mon..Fri *-*-* 18:30:00 Asia/Shanghai
OnCalendar=Mon..Fri *-*-* 19:30:00 Asia/Shanghai
Persistent=true
Unit=jixie-maintenance.service
```

每周 timer：

```ini
[Timer]
OnCalendar=Sun *-*-* 04:30:00 Asia/Shanghai
Persistent=true
Unit=jixie-maintenance-weekly.service
```

实现时必须在目标主机执行 `systemd-analyze calendar` 验证时区语法。若 systemd 版本不支持行内时区，
统一服务器时区或使用该版本支持的 `Timezone=` 配置，并在验收中核对下一次触发时间。

`Persistent=true` 只保证 timer 恢复时，如果停用期间至少错过过一次触发，就立即启动一次 service；
它不会把错过的每个 17:30、18:30、19:30 逐次重放。因此 daily CLI 未显式给日期时必须：

1. 找到上海时间最近已收盘的 SSE 交易日；
2. 从连续发布水位之后枚举全部缺失开市日；
3. 在同一次 service 中补齐整个缺口。

例如周一上午补跑时，截止日是上周五；若服务已停机四个交易日，就补四天，而不是只补上周五。

## 4. 互斥、运行状态与 App 维护模式

### 4.1 强互斥：文件锁

daily、weekly 和历史修复共用：

```text
/var/lib/jixie/maintenance.lock
```

使用 `flock` 做强互斥。锁绑定进程持有的文件描述符，进程退出、崩溃或被 kill 后由内核自动释放。锁
文件本身不删除。

systemd service 通过同一个入口取得锁：

```ini
ExecStart=/usr/bin/flock -n -E 75 \
  /var/lib/jixie/maintenance.lock \
  /usr/bin/node /opt/jixie/apps/api/dist/scripts/run-daily-maintenance.js
```

退出码 `75` 解释为 `already_running`。生产人工补跑优先使用 `systemctl start`；若直接运行 CLI，外层
也必须经过同一个锁封装。不能通过直接执行若干低层 `sync:*` 命令绕过锁和状态机。

备份不使用此维护锁。SQLite 在线备份允许 API 运行时生成一致快照；它只在自己的 service 内避免重复
实例。

### 4.2 可观测状态：`MaintenanceRun`

文件锁负责互斥，数据库记录负责可观测性、重试语义和前端维护状态。建议新增：

```text
MaintenanceRun
  id
  kind              daily | weekly | repair
  targetKey
  startDate
  endDate
  trigger           timer | manual
  status            running | done | error
  stage
  attempts
  summary            JSON
  error
  heartbeatAt
  startedAt
  finishedAt
  createdAt
  updatedAt

unique(kind, targetKey)
index(status, updatedAt)
```

`targetKey` 是幂等身份：daily 使用交易日，weekly 使用 ISO 周或周起始日，repair 使用
`startDate:endDate`。`startDate/endDate` 保存真实影响区间，避免两个不同历史修复任务因共用结束日期而
被误判为同一任务。

另需维护一个连续发布水位，例如 `MaintenanceState.dailyPublishedThrough`：

- 首次全量导入通过完整性审计后，把水位初始化为最后一个完整交易日；
- 只有水位之后的每个 SSE 开市日都完成原始数据、market-state 和后置验证，水位才能向前推进；
- 不能使用任意原始表的 `MAX(tradeDate)` 或“最新一条 done run”替代连续水位，因为中间可能有洞；
- 状态接口的 `lastSuccessfulDailyDate` 就来自这个水位；
- daily/weekly 回查若发现水位之前的允许列表缺口，先自动修复并重算受影响派生区间；超出单轮修复上限
  时本轮非零退出且不倒退水位，后续重试从剩余缺口继续。无法确定语义的问题才进入人工 repair。

状态规则：

- 取得 `flock` 后，在短事务中创建或更新 `running`，然后才访问外部数据源和修改市场数据；
- 每完成一个 stage 更新 `stage`、`heartbeatAt` 和阶段摘要；
- 同目标数据流水线已 `done` 时跳过数据阶段，只检查是否有需要重试的失败信号；
- 上次是 `error` 时增加 `attempts` 并从安全边界重跑；
- `--force` 允许人工重跑 `done`，必须在日志和 summary 中记录；
- 正常失败和捕获到的终止信号写 `error`；
- coordinator 每 30 秒刷新 `heartbeatAt`。`SIGKILL` 无法运行清理逻辑，因此下一次 service 取得文件
  锁后会先把所有遗留 `running` 标成 `interrupted/error`，再重试目标任务；前端不会因一条永久残留
  的 `running` 记录无限停在维护页。

`MaintenanceRun` 是运维数据，不加入 Agent 只读 SQL 白名单。

### 4.3 App 维护 Gate

API 提供不受维护中间件限制的轻量接口：

```text
GET /api/maintenance/status
```

响应只暴露必要的非敏感信息：

```json
{
  "active": true,
  "runId": "01...",
  "kind": "daily",
  "startDate": "20260725",
  "endDate": "20260730",
  "completedDates": 2,
  "totalDates": 4,
  "lastSuccessfulDailyDate": "20260728",
  "stage": "market_state",
  "startedAt": "2026-07-30T09:30:00.000Z",
  "heartbeatAt": "2026-07-30T09:31:12.000Z",
  "retryAfterSeconds": 5
}
```

维护期间：

- `/api/health`、`/api/maintenance/status` 和维持登录判断所需的最小 auth 接口继续可用；
- 其他 `/api/app/*` 请求统一返回 HTTP `503`，错误码为 `MAINTENANCE`，并带 `Retry-After`；
- API 不接受新的回测、因子分析、参数扫描、Agent 数据计算或手动信号任务；
- maintenance CLI 直接调用领域函数和 Prisma，不通过会拦截业务请求的 HTTP 路由。

前端使用全局 `maintenanceStore`：

1. App 启动时检查状态，任一 API 收到 `MAINTENANCE` 时立即激活；
2. 已打开页面上覆盖全屏维护 Gate，不卸载当前路由，避免丢失 Lab 草稿和临时 UI 状态；
3. 维护界面使用项目统一的 `PollingModel` 每 5 秒查询 `/api/maintenance/status`；
4. `done` 后刷新当前 URL，让所有页面数据按新的 `dataRevision` 重新加载；
5. 当前路由始终保留在浏览器 URL 中，无需额外保存开放重定向参数。

daily 在目标截止日尚未发布、weekly 失败或 repair 失败时保持 `active=true`，等待下一档重试或人工
修复；这是保守策略，因为 weekly/repair 可能已经原子替换了若干切片，不能证明整个跨表版本仍一致。
旧 daily 错误若其截止日已经被连续水位覆盖，则不再阻塞 App。

用户可见的默认数据截止日取最近一条成功 daily run，而不是各原始表的 `MAX(tradeDate)`。因此即使某
次尝试已经原子发布了原始目标日、却在 market-state 阶段失败，产品也不会把未完成日期误报为已就绪。

## 5. 所有同步步骤的统一契约

低层同步函数是 maintenance pipeline 的构件，必须满足相同契约。

### 5.1 前置校验

- 参数符合 `YYYYMMDD`，范围顺序正确；
- 目标日是已经收盘的交易日，历史回填除外；
- 上游接口返回的 `trade_date`、代码格式和请求目标一致；
- 返回代码不重复，关键字段满足接口语义；
- 候选行数和最近交易日基线相比没有异常断崖；
- 有成对数据时先验证集合覆盖，例如 `Daily` 与 `AdjFactor`；
- 候选数据不完整时，绝不能先删除库里已有的完整数据。

### 5.2 幂等写入

- 先完成所有外部请求和候选数据校验，不在数据库事务内等待网络；
- 以“目标日期”或“代码 × 日期区间”为最小替换单元；
- 校验通过后使用事务执行 `deleteMany + createMany`；
- 同样输入重复执行，最终数据库状态相同；
- 写入后重新检查行数、代码覆盖和最大日期；
- 失败抛出错误并让 CLI 返回非零。

“目标日期已有任意一行就跳过”不算完整性，也不适用于每日维护：

- 历史回填模式可以跳过已经通过完整性标记的日期或分片；
- daily/weekly 维护对目标切片使用 `refresh`，每次重试都重新拉取；
- 完整性标记只能在写入和后置校验全部成功后提交。

### 5.3 复权因子

股票 `Daily` 和 `AdjFactor` 必须成对拉取、成对校验并在同一发布事务写入。引擎使用
`close × adjFactor` 计算后复权价格，市场状态的 20/60 日均线和收益也依赖精确日期的复权因子；缺失
时不能用“有一行就算准备好”掩盖。

ETF 日线与 `EtfAdjFactor` 同样成对维护。每日刷新已部署策略使用的 ETF 和产品约定的主要 ETF；完整
ETF 历史仍走独立回填。

每日对 catch-up 中的每个缺失日期强制刷新。为覆盖供应商事后修订，每周任务可以刷新最近 90 个交易日
的复权因子并做差异审计；如实测会产生历史变更，记录受影响区间并重算对应市场状态。

## 6. 每日维护流水线

命令：

```bash
pnpm --filter api maintenance:daily [YYYYMMDD] [--force]
```

生产由 `jixie-maintenance.service` 调用同一入口。不能让 timer 拼接多个松散的 `pnpm sync:*` 命令。

### Catch-up 语义

不带日期的 `maintenance:daily` 是 catch-up coordinator：

```text
刷新/获取交易日历候选
→ cutoff = 最近已收盘 SSE 交易日
→ missingDates = (dailyPublishedThrough, cutoff] 内全部开市日
→ 回查水位前最近 5 个已发布交易日并自动修复允许列表缺口
→ 按日期升序补齐原始数据，得到连续通过门禁的 readyThrough
→ 重算 min(最早历史修复日, earliestMissing) ~ readyThrough 的 market-state
→ 逐日提交已完成前缀的 MaintenanceRun.done
→ 连续推进 dailyPublishedThrough 到 readyThrough
→ readyThrough = cutoff 时才为 cutoff 生成当前可执行信号
```

显式传入 `YYYYMMDD` 时只处理该日期，主要用于人工补跑；历史区间优先使用
`maintenance:repair start end`。

每次 catch-up 使用一个以 cutoff 为 `targetKey` 的 daily `MaintenanceRun`，summary 持续记录当前日期
和 `completedDates / totalDates`。每完成一个连续前缀就推进 `dailyPublishedThrough`；即使进程随后
崩溃，下次也会从水位后的首个未完成日期继续，前端显示例如 `3 / 7 trading days`。

缺口较大时不能静默跳到最新一天。实现可以分批拉取和发布；超过运维阈值（建议 20 个交易日）时升级
日志和告警级别，并显示为 catch-up/repair，但最终仍要补齐全部日期。不能因阈值而把水位跨过缺口。

### Stage 0：取得锁与登记运行

1. 取得 `/var/lib/jixie/maintenance.lock`；
2. 使用本地交易日历确定 cutoff；本地日历不足时只拉取候选日历到内存，暂不修改数据库；
3. 从 `dailyPublishedThrough` 到 cutoff 枚举 `missingDates`，并回查水位前最近
   `MAINTENANCE_DAILY_REPAIR_LOOKBACK_DAYS`（默认 5）个开市日；
4. 没有向前缺失日期时仍以短维护运行回查已发布切片；无缺口时直接进入 Stage 6，有允许列表缺口时
   自动重拉、重新过门禁并按需重算派生数据；
5. 为本次 cutoff 创建或接管 daily `MaintenanceRun`，写入 `running / stage=starting`；
6. App 进入维护模式并展示 catch-up 范围和进度；
7. 阻止新增长任务，并等待已经运行的数据读取 worker 和 Agent 数据工具到达终态；清零后还保持默认
   5 秒安静窗口，以覆盖“请求刚通过 Gate、尚未来得及登记 Job”的竞态。等待超时则在任何市场数据写入
   前失败，留给下一时点重试。

### Stage 1：交易日历

1. 校验并发布 SSE 交易日历至 cutoff 之后至少 14 个自然日；
2. 重新确认 `missingDates` 都是已经收盘的开市日；
3. 确认存在下一交易日，供信号 `execDate` 使用；
4. 非交易日或尚未收盘时成功空跑，不创建空信号。

### Stage 2：拉取并校验缺失日原始数据候选

对 `missingDates` 按日期升序拉取到内存并完成前置校验，不立即覆盖数据库。每个日期都包括：

1. 股票 `Daily + AdjFactor`；
2. `DailyBasic`；
3. `StkLimit`；
4. `Moneyflow / TopList`（每日都刷新；龙虎榜当天为空是合法结果）；
5. 主要指数 `IndexDaily / IndexDailyBasic`；
6. 活跃部署和产品约定范围内的 `EtfDaily + EtfAdjFactor`；
7. 产品启用期货后需要的当日合约行情、主力映射和结算参数。

17:30 接口若只返回部分数据，对应日期失败，不进入该日期的发布事务，也不破坏上一次完整快照。更早
日期构成的连续完整前缀仍可进入 Stage 5、发布 market-state 并推进水位；下一时点只从失败日期继续。

### Stage 3：发布当日原始数据

每个日期的候选全部通过后，以该日期为边界原子替换。优先把股票核心表
`Daily / AdjFactor / DailyBasic / StkLimit` 放在同一个事务中，避免 App 或 worker 看到跨表半更新。
扩展表也必须按目标切片事务替换。

事务时间要实测。如果单次目标日发布事务过长，改用 staging table 先写候选，再用短事务 promote；不能
退回为一张表一张表裸写并在中间开放 App。

#### 股票代码身份收敛

股票换代码后，历史数据必须以 `StockCodeChange.newTsCode` 作为统一存储身份。目标实现是在每个同步
入口写入候选时调用 `canonicalStockCode()`，覆盖：

- `Daily / AdjFactor / DailyBasic / StkLimit`；
- `Moneyflow / TopList / FinaIndicator / Dividend`；
- `SwIndustryMember.tsCode`；
- `IndexWeight.conCode`；
- 股票名称历史及以后新增的所有股票关联表。

`StockCodeChange` 是经交易所确认、随版本发布维护的注册表。定时运行
`canonicalize:stock-codes` 不能发现注册表之外的新代码变更，所以不能把“每天跑一次修复脚本”当成
身份治理。发现新的代码继承关系时，必须先核实来源、更新注册表和测试，再执行受锁保护的 repair。

在所有写入口完成规范化之前，daily/weekly/repair 在发布候选后执行快速旧代码探测；仅在已登记的旧代码
确实存在时，才在同一维护锁内调用幂等的 `canonicalize:stock-codes`。若旧、新代码在相同业务键上的内容
冲突，脚本必须失败并阻止水位推进，不能静默选择一边。首次全量导入结束和任何历史区间重拉之后也必须
执行该收敛步骤。规范化必须报告修改表、修改行数和最早受影响日期；如果改动了 `Daily / AdjFactor /
DailyBasic / StkLimit / IndexWeight / SwIndustryMember`，Stage 5 的重算起点取
`min(earliestMissingDate, earliestCanonicalizedDate)`，不能只重算当天。

旧、新代码分裂会影响：

| 数据不一致 | 直接后果 |
|---|---|
| `Daily` 与 `AdjFactor` 代码不同 | 内连接丢行，复权价、收益率、均线、因子和回测历史错误 |
| `Daily` 与 `DailyBasic / StkLimit` 代码不同 | 换手、市值、涨跌停字段缺失，市场活跃度、拥挤度和极端行情统计失真 |
| `Daily` 同时保留旧、新代码 | 同一证券在截面中重复，涨跌家数、成交额、排名和因子分位数偏移 |
| `IndexWeight.conCode` 与行情代码不同 | 指数成分漏算，`IndexIndicator` 的宽度、趋势和成交统计错误 |
| `SwIndustryMember.tsCode` 与行情代码不同 | 股票无法归属行业，`IndustryIndicator` 和行业中性化结果错误 |
| `Moneyflow / FinaIndicator / Dividend` 与行情代码不同 | 资金流和基本面因子缺失，分红与复权异常无法正确关联 |
| 一只股票的历史被拆成两个代码 | 20/60 日窗口中断，筛选、信号、图表和回测只能看到部分历史 |

### Stage 4：完整性总门禁

每个缺失日期发布后必须检查：

- `Daily` 当日行数相对最近 20 个交易日中位数；
- `Daily` 代码集合被 `AdjFactor` 近乎完整覆盖；
- `DailyBasic / StkLimit` 相对 `Daily` 的覆盖率；
- 主要指数当前日期行数和预期代码集合；
- 资金流相对日线的连接覆盖率（当前至少 70%），以及活跃部署依赖的 ETF 数据是否齐备；
- 所有目标表都覆盖当前缺失日期；
- 关键数值的 null、零值和异常值比例没有断崖；
- 最近 60 个交易日的日线与复权覆盖足以计算窗口指标；
- `IndexWeight` 与申万行业成员存在不晚于当前日期的有效 PIT 快照。
- 目标日期及其窗口内不存在 `StockCodeChange.oldTsCode`，股票关联表连接使用的代码集合一致；

阈值必须先根据生产历史分布测量后固化，不能凭经验填写一个常数。任何核心门禁失败都终止本轮，不生成
市场状态和策略信号。

daily 不直接运行默认全历史范围的 `pnpm audit:data`。它执行与当前发布范围等价的增量严格门禁，避免
每天扫描数千万历史行。已登记旧代码、无法解释的孤立代码、核心表日期缺口和关键连接覆盖不足都属于
`error`，必须阻止发布；普通 `warn` 只在明确列入允许规则时放行，并记录到 daily summary 和告警。

### Stage 5：生成派生市场状态

对从 `earliestMissingDate` 开始、原始数据和总门禁连续通过的最大前缀执行：

```ts
syncMarketIndicators(earliestMissingDate, readyThrough)
```

即使缺口不连续，也重算最早缺失日至 `readyThrough` 的连续区间，保证滚动窗口和中间已存在日期使用
同一版输入。某个日期未通过门禁时不能越过它处理更晚日期。

这是数据生产流水线的最后一个派生步骤，依赖：

```text
TradeCal
  └─ 最近 60 个交易日

Daily + AdjFactor + DailyBasic + StkLimit
  └─ MarketIndicator

上述股票面板 + IndexWeight + IndexDaily
  └─ IndexIndicator

上述股票面板 + SwIndustryMember
  └─ IndustryIndicator
```

每个年度 slice 内的三张派生表必须在同一事务中替换，不能先删除后留下空表。完成后对截至
`readyThrough` 的完整前缀逐日验证：

- `MarketIndicator` 每个 ready date 恰有一条记录；
- `IndexIndicator` 覆盖约定的主要指数；
- `IndustryIndicator` 行业数量与近期正常区间一致；
- 三张表覆盖全部 ready dates；
- 核心比例在定义域内，行数和样本数没有异常断崖。

### Stage 6：生成策略信号

只有 `readyThrough === cutoff`，市场数据和派生状态全部追平后，才为 cutoff 生成当前仍可执行的信号：

1. 查询活跃 `StrategyDeployment`；
2. 只调用“生成信号”函数，不再执行第二轮数据同步；
3. 部署按上线顺序串行计算，避免同时占满 SQLite、CPU 和 isolate 内存；
4. `SignalRun(deploymentId, tradeDate)` 唯一，已有 `done` 时不重复计算；
5. 同一 run 的重试复用 `SignalRun`，每次 attempt 新建 Job；
6. 仅首次提交终态后发送一次通知。

`SignalRun` 的唯一键只能保护结果表，不能替代 maintenance 锁、数据完整性门禁或通知幂等。

历史缺失日默认不生成“下一交易日执行”的过期通知。若以后为了审计补算历史 `SignalRun`，必须显式
标记 `backfilled` 并强制 `notify=false`；最新 cutoff 的全历史重放已经包含中间交易日，不依赖逐日发送
历史信号。

单个策略信号失败不回滚已经完成的市场数据，也不把 daily 数据流水线重新标记为失败。错误记录在对应
`SignalRun` 和 daily summary；18:30、19:30 只重试失败或 stale 的信号，不重新抓取已通过门禁的
同日数据。这样既保留自动重试，也不会因为一段用户策略代码持续报错而重复消耗全市场接口配额。

### Stage 7：完成

写入：

- 每张表逐个缺失日的行数和覆盖率；
- 派生表行数；
- 部署总数、成功数和失败数；
- 每个 stage 耗时；
- 数据截止日和可复现数据 revision；
- 每个缺失日对应的 `status=done / stage=complete / finishedAt`。

每次得到连续通过的 `readyThrough` 后先单调推进 `dailyPublishedThrough`，再更新 run summary。若进程
恰在两次短写之间退出，下次取得文件锁时会把遗留 run 标成 interrupted，并从已经持久化的水位继续。
如果尚未到 cutoff，本次 run 保持 `error`、service 返回非零并维持维护 Gate；追平 cutoff 后提交完成
状态，前端重新加载当前 URL，进程退出后释放文件锁。

## 7. 每周维护流水线

命令：

```bash
pnpm --filter api maintenance:weekly [--force]
```

与 daily 共用文件锁和 `MaintenanceRun` 状态机，避免周日人工补跑 daily 时并发写 SQLite。

错过多个周日后不逐周启动多次完整任务。weekly 从上次成功水位增量刷新到当前时间，必须覆盖期间所有
公告、财报、分红、成分和成员快照，再执行一次当前完整性审计和必要的历史 market-state 重算。

建议顺序：

1. `StockBasic` 与股票名称历史；
2. `FinaIndicator`；
3. `Dividend`；
4. `IndexWeight` 当前及最近季度快照；
5. 申万行业分类与成员 spell；
6. ETF 元数据；
7. 期货合约元数据、交易参数和主力映射；
8. 回查最近 `MAINTENANCE_WEEKLY_REPAIR_LOOKBACK_DAYS`（默认 252）个已发布交易日的核心量价、资金
   流和主要指数切片，并自动修复允许列表缺口；
9. 对所有股票关联表执行代码身份检查，并按需收敛已登记的旧代码；
10. 对近期窗口运行严格数据审计，并运行全表结构审计；
11. 对受代码、成分、行业成员、核心量价或指数修订影响的日期区间重算 market-state；
12. 验证派生表，写入 weekly summary 并退出维护模式。

同步函数必须返回“新增、更新、删除数量”和“最早受影响日期”。只有以下变化需要触发历史派生重算：

- `IndexWeight` 新增、修订或回溯；
- `SwIndustryMember` spell 新增、修订或回溯；
- 历史 `AdjFactor` 发生变化。
- 代码身份收敛修改了行情、复权、涨跌停、估值、指数成分或行业成员。

财务、分红和名称历史目前不参与三张 market-state 表，不因这些变化无条件重算市场状态。它们仍会改变
因子、筛选或历史可投资状态，数据 revision 必须更新。

周任务不能直接复用“已有股票就永久跳过”的历史回填语义。财务和分红需要按近期公告或受影响股票真正
增量刷新；指数成分要保留历史快照，不能用当前成分覆盖过去。

`audit:data` 是只读诊断，不负责修复。生产审计分三档：

- daily：当前发布范围的增量门禁，属于 daily pipeline；
- weekly：建议覆盖最近 252 个交易日的质量审计，并对代码身份、股票主表、名称 spell、PIT 资料做
  全表结构检查，属于 weekly pipeline；
- 首次导入、历史 repair 或人工排障：对明确的完整历史范围执行 `audit:data ... --strict`。

现有 `audit:data --strict` 只在 `error` finding 时返回非零。实现 maintenance coordinator 时必须保存
每条 finding 和采用的放行策略，不能只保存进程退出码；已登记旧代码残留当前属于错误，不应降级为
可长期忽略的 warning。

自动修复器不解析审计文案来猜动作。它直接按交易日统计密集表覆盖和约定指数代码集合，生成固定允许
列表，再调用与 daily 相同的原子刷新函数。weekly 单轮默认最多修复 20 日
（`MAINTENANCE_MAX_AUTO_REPAIR_DATES`）；超过时明确失败并保留剩余日期，避免一次供应商异常触发无界
请求。下一次幂等重试会继续处理。

## 8. 数据库备份

命令：

```bash
pnpm --filter api backup
```

生产配置：

```ini
Environment=JIXIE_DB_PATH=/var/lib/jixie/prod.db
Environment=JIXIE_BACKUP_DIR=/var/backups/jixie
Environment=JIXIE_BACKUP_KEEP=2
```

要求：

1. 使用 `sqlite3 .backup`，不直接 `cp` WAL 模式下正在写入的数据库；
2. 校验副本可打开、核心表可读；
3. 校验成功后才参与轮转；
4. 每天保留最近 N 份；
5. 首次安装 timer 时立即手动备份并做一次恢复演练；
6. VPS 单盘备份只防误操作，不防实例或磁盘整体损坏，后续必须增加异地复制。

备份失败不改变 `MaintenanceRun`，但必须让 service 返回非零并进入独立告警。

错过的历史备份无法事后重建。timer 恢复后立即生成一份当前数据库快照即可；异地存储需要历史恢复点
时，应依赖已经成功上传的旧备份，而不是伪造停机期间的每日文件。

## 9. 手动执行与修复

### 9.1 推荐的生产入口

```bash
# 自动补齐 continuous watermark 到最近已收盘交易日
sudo systemctl start jixie-maintenance.service

# 查看执行状态和日志
systemctl status jixie-maintenance.service
journalctl -u jixie-maintenance.service -n 200 --no-pager

# 每周维护
sudo systemctl start jixie-maintenance-weekly.service

# 在线备份
sudo systemctl start jixie-backup.service
```

### 9.2 指定日期补跑

需要指定日期或 `--force` 时，使用受同一文件锁保护的运维封装：

```bash
flock -n -E 75 /var/lib/jixie/maintenance.lock \
  env JIXIE_MAINTENANCE_LOCK_HELD=1 \
  pnpm --filter api maintenance:daily 20260730 --force
```

`--force` 不绕过前置校验和完整性门禁，只绕过“同目标已经 done”的短路。任何跳过数据质量检查的能力都
必须是单独、名称明确的灾难恢复工具，不能藏在普通 force 中。

不带日期的 CLI 与 systemd service 相同，会自动 catch up 全部缺失交易日：

```bash
flock -n -E 75 /var/lib/jixie/maintenance.lock \
  env JIXIE_MAINTENANCE_LOCK_HELD=1 \
  pnpm --filter api maintenance:daily
```

### 9.3 历史区间修复

历史修复不直接裸跑 `sync:market-state`。推荐增加：

```bash
flock -n -E 75 /var/lib/jixie/maintenance.lock \
  env JIXIE_MAINTENANCE_LOCK_HELD=1 \
  pnpm --filter api maintenance:repair 20260701 20260730
```

顺序仍为：

```text
取得同一文件锁
→ 登记 repair MaintenanceRun
→ 审计原始数据覆盖
→ 只同步缺失或明确要求刷新的原始切片
→ 收敛股票代码身份
→ 再次完整性检查
→ 重算受影响 market-state
→ 验证派生表
→ 更新 data revision
```

现有 `sync:*` 命令保留为开发、首次回填和 maintenance 内部构件，但不作为生产日常运行手册的入口。

### 9.4 首次初始化自愈

`pnpm import:data` 在最终 market-state 和严格审计之前自动执行：

```bash
pnpm --filter api maintenance:heal-baseline [YYYYMMDD]
```

它以最近已收盘 SSE 交易日为上限，默认回查 20 日，修复确定性的密集切片缺口。随后全量
market-state、严格审计和 `maintenance:init` 仍依次执行；任一步失败都不会初始化或推进发布水位。
单独执行 `maintenance:init [YYYYMMDD]` 时也会先自愈目标日并补算缺失的派生快照，适合恢复已完成导入
但尚未建立水位的实例。

## 10. 并发模型与失败处理

### 10.1 需要防止的并发

- daily 的 17:30 尝试尚未结束，18:30 再次触发；
- daily 与 weekly 重叠；
- systemd 与人工 CLI 重叠；
- 旧的进程内 scheduler 与 systemd 重叠；
- 多个 API 实例同时运行内置 scheduler；
- 维护写入期间用户启动回测、因子分析或手动信号；
- 两个信号进程同时执行“查询不存在后创建”，触发唯一键竞态；
- market-state 长事务与普通 API 写入竞争 SQLite 单写锁。

systemd 同一个 oneshot service 本身不会启动第二个 active 实例，但它不能覆盖另一个 service 或直接 CLI，
因此仍必须使用共享文件锁。

### 10.2 SQLite 约束

WAL 允许读者和写者较好地并存，但不能支持两个并发写者，也不能自动提供跨多次查询的一致业务快照。
`busy_timeout` 只能缓解短暂锁竞争，不能作为维护并发设计。

因此：

- 外部 API 请求不放在数据库事务中；
- App 在维护期间不启动新的长任务；
- 原始数据先校验候选，再用短事务发布；
- market-state 保持目标切片原子替换；
- 信号在数据发布完成后串行生成；
- 所有可能写市场数据的维护入口共用 `flock`。

### 10.3 失败语义

| 失败位置 | 数据状态 | App 行为 | 下一步 |
|---|---|---|---|
| 拉取或候选校验失败 | 数据库未变 | 恢复旧数据并提示更新失败 | 下一时点重试 |
| 原始发布事务失败 | 事务回滚 | 恢复旧数据 | 下一时点重试 |
| 完整性总门禁失败 | 原始目标切片已原子发布，但未获准下游使用 | 使用上一成功截止日 | 下一时点强制刷新 |
| market-state 失败 | 三张派生表事务回滚 | 显示上一成功市场状态并告警 | 下一时点重算 |
| 单个策略信号失败 | 市场数据与派生状态已完成 | App 可恢复；该部署显示失败 | 重试该 SignalRun |
| MaintenanceRun 写终态失败 | 业务阶段可能已完成，状态未知 | stale 超时保护，显示异常 | 人工检查 journal 后接管 |

失败后不能通过“把状态改成 done”解锁。必须确认数据库处于上述可解释状态，再由同一 pipeline 重试或
人工修复。

## 11. 可观测性与告警

部署文档必须包含：

```bash
systemctl list-timers 'jixie-*'
systemctl status jixie-maintenance.service
journalctl -u jixie-maintenance.service -n 200 --no-pager
systemctl status jixie-maintenance-weekly.service
systemctl status jixie-backup.service
```

日志每行使用固定前缀：

```text
[maintenance:daily]
[maintenance:weekly]
[backup]
```

最低告警条件：

- timer/service 返回非零；
- `MaintenanceRun.running` heartbeat 过期；
- 最近成功 daily 落后最近已收盘交易日；
- 原始数据、market-state 和 SignalRun 截止日不一致；
- 三个收盘重试时点全部失败；
- 最近一次备份超过 36 小时或副本校验失败；
- 周任务超过 8 天未成功。

不能把“systemd service 退出 0”当作唯一成功标准。完成标准是状态表、数据覆盖、派生表和信号截止日
相互一致。

## 12. 实施阶段

### Phase A：每日维护与维护 Gate

1. 为目标日密集同步增加 `refresh` 和候选校验；
2. 把股票核心表改为候选数据统一发布；
3. 新增 `MaintenanceRun` migration 和状态服务；
4. 新增 App maintenance status API、503 中间件和前端全屏 Gate；
5. 从 `runDailySignalCycle` 抽出“只生成信号”的函数；
6. 新增 daily pipeline、CLI、service、timer 和安装脚本；
7. 生产关闭进程内 scheduler，手动验收后 enable timer；
8. 连续观察至少三个交易日后删除内置 scheduler。

### Phase B：备份

1. 修复模板中的生产 DB 路径和 systemd directive 注释；
2. 安装 backup service/timer；
3. 立即备份、验证副本并做恢复演练；
4. 增加备份过期告警。

### Phase C：每周维护

1. 为财务、分红、指数成分等实现真正增量刷新；
2. 让同步函数报告受影响日期；
3. 新增 weekly pipeline、service 和 timer；
4. 验证必要的历史 market-state 重算。

### Phase D：异地备份与外部告警

1. 将最新已验证备份推送到独立存储；
2. 增加 timer 失败、数据日期滞后和备份过期的外部告警。

## 13. 测试与生产验收

### 13.1 自动测试

- 非交易日成功空跑；
- 17:30 候选数据部分返回时不覆盖旧数据；
- 18:30 refresh 后成功；
- timer 停止四个交易日后只激活一次 service，但能按顺序补齐四天；
- catch-up 中途崩溃后从首个未完成交易日恢复；
- 中间存在洞时连续水位不能跨过缺失日期；
- 最新日期数据不完整时，更早的连续完整前缀仍能发布并推进水位；
- catch-up 区间重算 `earliestMissing ~ readyThrough` 的 market-state；
- 历史缺失日不发送过期信号，只有 cutoff 允许通知；
- `Daily + AdjFactor` 成对发布；
- 完整性未过时不生成 market-state 和信号；
- 已登记旧代码残留时 daily 不推进水位；规范化后重试能够通过；
- 旧、新代码同业务键数据冲突时规范化失败且不静默覆盖；
- `Daily` 与 `AdjFactor / DailyBasic / StkLimit` 代码集合错位时完整性门禁失败；
- weekly 在慢频同步后规范化 `IndexWeight.conCode` 和 `SwIndustryMember.tsCode`，再重算受影响区间；
- 新的未登记代码变更被结构审计报告为无法解释的身份，不由 timer 自动猜测映射；
- 同日数据 `done` 且没有失败信号时再次触发直接退出；
- 同日数据 `done` 但存在失败信号时只重试对应 `SignalRun`；
- `--force` 可重跑且不产生重复 `SignalRun` 或通知；
- daily、weekly、repair 互斥；
- maintenance 进程被 kill 后文件锁释放，stale 状态可接管；
- App 在 running 时收到 `MAINTENANCE`，完成后恢复原页面；
- market-state 按 catch-up 区间替换，每个年度 slice 内三张表一起回滚；
- API 重启不影响 systemd timer；
- systemd unit 通过 `systemd-analyze verify`。

### 13.2 生产验收

1. 首次全量导入和数据审计通过；
2. 所有股票关联表不存在已登记旧代码，随机抽样代码变更证券的行情、复权、成分和行业历史连续；
3. 全量导入结束时初始化 `dailyPublishedThrough` 基线；
4. 手动启动 daily service，journal 展示每个 stage；
5. 维护期间浏览器显示 Gate，Lab 当前 URL 和草稿不丢；
6. 原始行情与三张 market-state 表最大可用日期一致；
7. 有活跃部署时只产生一份 cutoff `SignalRun` 和一次通知；
8. 模拟停机多个交易日后恢复，单次 service 补齐全部缺口；
9. 次日重启 API 后 timer 仍存在且下一触发时间正确；
10. backup timer 生成可读副本，源路径明确为 `/var/lib/jixie/prod.db`；
11. daily 连续成功至少三个交易日后移除进程内 scheduler；
12. weekly 至少完成一次，并验证代码、成分或行业变化触发的受影响区间重算。

## 14. 完成定义

以下条件全部满足才算生产维护闭环完成：

- `systemctl list-timers 'jixie-*'` 能看到 daily、weekly 和 backup；
- API 代码中不存在生产进程内定时器；
- daily/weekly/repair 共用同一个文件锁；
- 所有目标日同步支持候选校验、原子替换、refresh 和后置验证；
- daily 能从连续发布水位补齐到最近已收盘交易日，不跨过任何缺口；
- 最近成功原始数据和 market-state 日期一致，每个活跃部署都有同日终态 `SignalRun`；
- 维护期间 App 有明确 Gate，失败不会永久卡住；
- 同日失败可自动重试，成功不重复计算或通知；
- 每日备份目标是生产库且已做恢复验证；
- 部署文档包含安装、手动补跑、日志、告警和恢复步骤。
