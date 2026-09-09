# Signals 后端阅读地图

Signals 将成功回测报告冻结为独立部署，按收盘数据生成下一交易日的指令，再记录模拟成交、人工成交和账户差异。它服务于策略部署、今日信号和执行对账；当前不接券商自动下单，仍保留既有 TS 与股票/ETF 支持限制。

## 从产品操作找入口

HTTP 总入口为 [routes.ts](routes.ts)，统一导出 `routes`，由 `server.ts` 挂到 `/api/app/signals`。部署创建接受 reportId，列表返回全部部署。根级路由只适配参数、状态和响应，业务操作自己检查归属并控制数据库写入。

| 操作 | HTTP 路径 | 业务入口 |
| --- | --- | --- |
| 启用策略部署 | `POST /deployments` | [deployments/manage.ts](deployments/manage.ts) 的 `deployBacktestReport`，检查回测证据、语言、资产和因子发布约束，冻结配置与血缘 |
| 查看部署列表、暂停 | `GET /deployments?strategyId=`、`POST /deployments/:id/pause` | [deployments/read.ts](deployments/read.ts)、[deployments/manage.ts](deployments/manage.ts) |
| 今日信号、运行历史与详情 | `GET /today`、`GET /runs`、`GET /runs/:id` | [runs/read.ts](runs/read.ts)，始终按用户归属查询，并带最新 Job、因子输入和成交记录 |
| 手动生成信号 | `POST /run` | [runs/submit.ts](runs/submit.ts) 的 `submitSignalRun`，确定收盘日并先结算，再调用入队操作 |
| 查询 Job 进度 | `GET /jobs/:jobId` | 通用 `infra/jobs/records.ts` 的 `getJob`，保持原所有者校验 |
| 录入、跳过或重置人工成交 | `PATCH /executions/:id` | [accounting/executions.ts](accounting/executions.ts) 的 `updateActualExecution`，更新后重建实际账户曲线 |
| 比较模型、模拟和实际账户 | `GET /deployments/:id/execution-overview` | [accounting/read.ts](accounting/read.ts) 的 `getStrategyExecutionOverview` |

## 目录职责

| 目录/文件 | 负责什么 |
| --- | --- |
| `deployments` | 部署创建/暂停、按报告的部署列表读取与响应映射；后续草稿编辑不会修改已有部署 |
| `runs/enqueue.ts` | 运行与 Job 的持久化、同一部署/日期的复用和失败重试；供 HTTP 与每日调度共用 |
| `runs/readiness.ts` | 上海收盘时点、交易日/下一交易日、基础数据就绪检查；Maintenance/CLI 复用 `latestCompletedTradeDate` |
| `runs/signal-worker.*` | IPC 子进程入口，读取冻结部署与因子血缘，调用 Strategy/Engine 捕获信号，返回结果后关闭数据库与 IPC |
| `accounting/initialize.ts` | 信号完成后创建成交行及模拟/实际两个账户基线 |
| `accounting/settlement.ts` | 读取已完成运行、逐日重放账户、事务内保存模拟成交与快照；人工成交修改时可完整重建实际账户 |
| `accounting/replay.ts` | 纯计算：先卖后买、可卖持仓、涨跌停/停牌、费用滑点、资金限制与收盘估值；不导入数据库 |
| `accounting/quotes.ts` | 对账用股票/ETF 行情、涨跌停价格及下一交易日读取 |
| `accounting/executions.ts`、`read.ts` | 人工成交状态变更、账户概览和成交响应映射 |
| `factor-inputs` | `lineage.ts` 解析并核对冻结依赖；`summary.ts` 汇总实际读取的因子输入、覆盖与决策标的值 |
| 根级 `signal-job.ts` | 具名任务契约，集中声明 parse/execute/complete/fail/recover/afterCommit |
| 根级 `scheduler.ts`、`sync.ts`、`notifier.ts` | 每日调度、所需市场数据同步、完成/失败通知；保留具体名称与原执行顺序 |

## 两条执行链

**手动运行：** HTTP → `submitSignalRun` → 解析用户指定或最近已收盘日期 → `settleStrategyAccounts` → `enqueueSignalRun` → 检查部署归属/状态、交易日、基础数据和所需利率曲线 → 事务中创建/复用 SignalRun 与 Job → 初始化日志并唤醒通用队列。

**每日运行：** Maintenance 的已发布数据流程 → `generateDailySignals`，或 CLI → `runDailySignalCycle` 先同步数据 → 结算账户 → 逐个 active 部署调用 `enqueueSignalRun` 并等待 completion。不会为每个部署重复同步市场数据。

共同计算链为 `signal-job.ts` → fork `runs/signal-worker` → 校验部署和运行的因子快照 → Strategy 准备因子并执行墙内信号捕获 → Engine 推进历史交易日 → 返回信号、模型持仓与因子输入 → 主线程执行任务完成事务。

源码通过 `.boot.mjs` 注册 tsx 后加载 `.ts`；生产直接启动编译 `.js`。两者使用同一个任务契约和算法，不能只更新静态 import 而遗漏 Worker URL。

## 需要保持的状态和事务边界

- **报告部署**：从成功报告冻结配置与 Factor 血缘；不同报告可同时 active。同报告由 activeReportId 唯一索引去重，暂停只清空该记录的占位键并改状态。再次部署创建新实例，已有信号与账户继续保留；旧部署不推断报告关联。
- **入队与重试**：同一部署/日期的 running 或 done 运行直接复用；error/stale 重试复用 runId、创建新 Job、清空旧计算/通知结果，保留运行自己的冻结因子依赖。运行创建/重置与 Job 创建在同一事务内，成功后才唤醒队列。
- **完成与恢复**：主线程在通用执行器事务中提交 SignalRun 与 Job 终态；启动恢复由 `signalJob.recover` 将中断运行置为 stale。Worker 只返回计算结果。
- **完成后动作**：`afterCommit` 先初始化会计，再发送通知；这两项仍在结果事务之外，失败不会撤销已完成的 SignalRun/Job。本次目录重整没有扩大事务，也没有改变原有失败收尾行为。
- **人工成交**：保留只能对已完成且已模拟结算的指令录入成交、不超过原指令股数、pending/filled/skipped 转换及重新计算实际账户的规则。逐日模拟成交与账户快照仍一起提交。

## 验证与阅读顺序

先读部署冻结和 `runs/enqueue.ts` 的复用/重试事务，再读 `signal-job.ts` 与 `accounting/settlement.ts`；只关心费用和账户算法时直接读 `accounting/replay.ts`。

原账户重放/数据库流、因子血缘/输入、通知和 Job 生命周期测试保留，路径随职责更新。新增 [routes.integration.test.ts](routes.integration.test.ts) 的隔离 SQLite + Hono 场景覆盖部署限制/版本冻结/事务回滚、日期与数据拒绝、运行幂等/重试、Job 写入失败回滚、读写归属，以及账户初始化/结算幂等与人工成交重置。参数元数据、因子准备和队列等待使用替身，不调用真实行情、邮件或 LLM。

Commit 9 已通过人工 review 和全部验证：全量 API 199 个测试文件、1073 项用例通过，API 编译通过；源码与编译后的真实 IPC 链路覆盖部署冻结、因子血缘、信号输入、完成后的会计初始化、结算/人工成交、失败重试及重启恢复。两种入口的信号、模型账户和对账结果一致，临时进程与数据库连接已释放。完整记录见 [开发计划](../../../../docs/design/backend-architecture-refactor.md#79-commit-9-实现记录2026-09-09)。

报告部署业务修订、迁移与验证计划见 [每日信号设计](../../../../docs/design/daily-signals.md)。上述 Commit 9 结果是历史记录，不代表本轮业务改动已经验证。
