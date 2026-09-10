# Strategy 后端阅读地图

Strategy 拥有策略定义、对话启动、回测与参数扫描，以及回测报告的风险分析。Engine 提供交易模拟；Factor 拥有因子定义与发布规则，Strategy 按这些规则准备执行依赖；通用 Agent 执行器处理对话和工具循环。三者的业务入口通过明确的函数调用协作。

## 从产品操作找入口

| 要理解或修改的行为 | HTTP 入口 | 业务入口 |
| --- | --- | --- |
| 策略列表、详情 | [definition-routes.ts](definition-routes.ts) | [definitions/read.ts](definitions/read.ts) |
| 创建、编辑、删除策略 | 同上 | [definitions/drafts.ts](definitions/drafts.ts)，配置保存与结果缓存失效在 [definitions/config.ts](definitions/config.ts) |
| 公开范围 | 同上 | [definitions/visibility.ts](definitions/visibility.ts)；引用自定义因子的策略保持私有 |
| 自动命名 | [workbench-routes.ts](workbench-routes.ts) | [definitions/name-request.ts](definitions/name-request.ts) 处理命名请求；[definitions/naming.ts](definitions/naming.ts) 负责名称生成、冲突处理和异步刷新竞争检查 |
| Agent 编辑与解释 | 同上 | [agent-turn.ts](agent-turn.ts)，可用指数和因子上下文在 [agent-context.ts](agent-context.ts) |
| 提交回测 | [backtest-routes.ts](backtest-routes.ts) | [backtest/submit.ts](backtest/submit.ts) → [backtest-job.ts](backtest-job.ts) |
| 历史回测报告、任务进度 | 同上 | [backtest/reports.ts](backtest/reports.ts)，读取冻结报告而非当前策略缓存 |
| 检查参数、提交扫描 | [scan-routes.ts](scan-routes.ts) | [scans/parameters.ts](scans/parameters.ts)、[scans/submit.ts](scans/submit.ts) → [scan-job.ts](scan-job.ts) |
| 扫描报告、任务进度 | 同上 | [scans/reports.ts](scans/reports.ts) |
| 回测报告中的风险研究 | 随完整回测报告返回 | [analysis/risk/backtest-risk-analysis.ts](analysis/risk/backtest-risk-analysis.ts)，没有独立风险 API |

根级 [routes.ts](routes.ts) 显式导出 `strategyRoute`，由 [resource-routes.ts](resource-routes.ts) 组合定义、工作台、回测与扫描路由，统一挂载 `/api/app/strategies`。`workbench-routes.ts` 只处理 Agent 与名称建议。回测与扫描分别位于 `/:strategyId/backtests`、`/:strategyId/scans`，报告和任务有各自明确的路径；修改定义与可见性使用 PATCH。实现文件直接引用子路由，不反向导入统一出口。HTTP 负责校验、传入 userId/locale、返回响应和映射业务异常。业务入口检查归属、忙碌状态并控制事务，接收普通参数，不接收 Hono Context。`operation-errors.ts` 与 `route-errors.ts` 分别表达业务拒绝和 HTTP 错误。完整契约见 [路由设计](../../../../docs/design/api-route-naming.md)。

## 目录职责

| 目录 | 拥有什么 |
| --- | --- |
| `definitions` | 策略输入、保存/读取、命名与公开范围；runKey 只包括影响回测的配置，改显示名不会清空结果 |
| `backtest` | 创建冻结配置、报告和 Job，查询报告与进度 |
| `scans` | 参数检查、扫描规格/网格/指标、冻结提交与报告；父 Worker 和 cell 子进程入口同处此目录 |
| `execution` | `run-configured` 按 TS/Python 分派执行并附加风险；`prepare-factors` 检查因子权限、发布状态、语言与依赖血缘 |
| `runtime/typescript` | SDK、编译、提示词、参数检查、isolate 宿主与墙内入口；配置 schema 沿用既有位置与双语言兼容行为 |
| `runtime/python` | Python 策略协议与宿主桥接，实际交易模拟仍由 TS Engine 执行 |
| `analysis/risk` | 回测后的市场暴露、宏观敏感度、Alpha/Risk 重合与压力情景；`data-readiness` 拥有这些模型的历史长度要求 |

`backtest-job.ts`、`scan-job.ts` 保留根级具名任务定义，集中声明 parse/execute/complete/fail/recover。bootstrap 注册定义，通用执行器负责领取、事务和重启恢复；Worker 计算结果由主线程通过任务契约提交。

## 三条主要调用链

**回测：** `submitStrategyBacktest` 校验日期 → 事务内检查所有者和正在运行的任务、保存配置、创建冻结 BacktestReport 与 Job → 事务提交后初始化日志并唤醒队列 → `backtest-job.ts` 启动 `engine/backtest-worker` → `execution/run-configured.ts` 准备因子并选择语言 → Engine 模拟 → 附加风险分析 → 主线程提交报告、策略缓存与 Job 终态。配置重名时保留原名称，报告和任务使用实际提交的名称。未知数据库错误继续抛出；不会在报告或 Job 创建失败后唤醒队列。

**参数扫描：** `submitStrategyScan` 检查语言/日期、隔离检查参数、规范化规格并解析样本内外交易日范围 → 冻结配置、参数、范围与数据截止日 → 事务内检查归属/重复任务并创建报告与 Job → `scan-job.ts` 启动 `scans/strategy-scan-worker` 线程 → 每个 cell fork 独立进程运行 → 汇总后由主线程提交。扫描不覆盖当前策略草稿。Python 扫描仍不支持；没有改变子进程退出判断和资源释放方式。

**Agent：** 前端先调用 Strategy 的 `/agent` → `startStrategyAgentTurn` 检查策略归属及运行中的 turn，构造指数/因子及当前代码上下文 → 通用 Agent 执行器执行 Strategy profile → 只读工具查询数据，生成代码经既有编译/受限运行时和标的检查后返回。前端随后使用通用 Agent 事件/取消接口。Agent 不提供配置保存或回测工具；用户核对代码和参数后通过工作台 `/backtest` 发起完整回测。Research 交接复用 Python Strategy profile 生成草稿，同样不自动回测。

## 风险数据和计算边界

`analysis/risk` 消费 [market/state/market-risk-drivers.ts](../market/state/market-risk-drivers.ts) 与 [market/macro/risk-axes.ts](../market/macro/risk-axes.ts) 的带血缘数据。Market 基础质量检查拥有覆盖、缺失和历史可得性；Strategy 的 `data-readiness.ts` 拥有市场模型完整 252 条历史窗口、宏观 36 条完整观察与审计取数窗口。最低拟合样本数和完整审计窗口是不同要求，不能互换。

[maintenance/risk-data-audit.ts](../maintenance/risk-data-audit.ts) 组合基础质量与模型就绪判断，[maintenance/data-audit.ts](../maintenance/data-audit.ts) 生成原整体审计报告。Market 不导入 Strategy。原状态、阈值、错误顺序及 CLI 输出保持。

风险后处理写入 `result.allocationAnalysis.risk`，对应策略工作台“回测结果 → 多资产配置归因 → 风险研究”。现有样本、日期、血缘与结果显示门槛保持，缺失不补零。风险后处理异常只记录原日志，不阻断主回测；交易循环中的持仓/成本累计仍归 Engine。

## Review 与验证定位

优先检查回测提交事务、扫描冻结参数和交易日范围、`definitions/config.ts` 的缓存失效、`execution/run-configured.ts` 的语言/资源生命周期，以及风险质量与模型门槛的拆分。引擎沙盒边界见 [Engine 阅读地图](../engine/README.md)。

新增 [routes.integration.test.ts](routes.integration.test.ts) 的 10 项 SQLite + Hono 场景覆盖归属、命名、缓存、忙碌保护、冻结报告、回测/扫描事务回滚、因子依赖私有策略、Agent 启动。LLM、队列调度、Agent 执行与参数检查使用测试替身；实际计算由既有引擎、runtime 和扫描测试覆盖。

新增 [runtime/typescript/wall-bundle.test.ts](runtime/typescript/wall-bundle.test.ts) 使用生产 bundle 配置检查真实 Engine 无宿主适配器及外部导入；Maintenance 审计测试新增 3 项场景覆盖基础质量/模型门槛分离、252/36 边界和错误顺序。现有测试随对应模块迁移。

Commit 8 已通过人工 review、全量 API 198 文件/1065 项测试与 API 编译。真实源码和编译 Worker 均覆盖 TS/Python 回测、扫描 cell 子进程及 Job 成功/失败/重启恢复；净值、成交、扫描指标和结果哈希在两种运行方式下一致。完整记录及验证限制见 [开发计划](../../../../docs/design/backend-architecture-refactor.md#78-commit-8-实现记录2026-09-09完成)。

## 旧策略演示清理（2026-09-09）

移除仅供开发者手动运行的 `backtest`、`code:backtest`、`turtle`、`zeng:timing`、`zeng:backtest` 命令及对应脚本，同时删除专用的 `examples/strategies.ts`、`examples/zeng.ts`。原横截面选股信号、EP 代码对照、海龟和曾庆辉策略实验不再作为 API app 的维护入口。历史架构设计与基线中的示例目录记录保留为当时状态。

正式策略 HTTP API、回测引擎、SDK 示例、自动化测试与数据库中的用户策略不变。本次不涉及 schema 或数据迁移。

验证记录：API typecheck、后端架构边界检查（0 violations）、package.json Prettier 检查及 `git diff --check` 均通过；代码与运维脚本中未发现已删除入口的残留引用。人工代码审查通过后，`src/engine/simulation/rules.test.ts` 的 15 项测试全部通过。本次仅删除无正式调用方的演示文件，未改动生产打包入口或配置，经审查调整验证范围，不运行 bundle 测试。
