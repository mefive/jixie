# Strategy 后端阅读地图

业务错误统一在 [errors.ts](errors.ts) 定义，调用点直接抛出模块错误；HTTP 分类与翻译由公共边界完成。约定及例外见 [错误设计](../../../../docs/design/api-errors.md)。

Strategy 拥有策略定义、对话启动、冻结回测与扫描报告，以及完整回测的风险分析。[Engine](../engine/README.md) 负责交易模拟，Factor 拥有因子定义和发布，Signals 拥有报告部署；这些流程通过具体函数协作。

## 按业务问题进入

| 要找什么 | 子能力与责任 |
| --- | --- |
| 策略草稿、命名、公开范围、Research 交接 | [definitions](definitions/README.md)：配置保存、缓存失效和目标持久化 |
| 提交回测、读历史报告、找任务 | [backtests](backtests/README.md)：正式回测冻结、Job 和双语言完整编排 |
| 参数／仓位／资金规模比较 | [scans](scans/README.md)：扫描规格、独立报告、Worker 内串行模拟 |
| 提取因子键或准备可运行因子 | [factor-inputs](factor-inputs/README.md)：纯 references 与有权限／语言／血缘检查的 prepare |
| 回测风险解释与数据门槛 | [risk](risk/README.md)：暴露、宏观、Alpha/Risk、压力情景及模型就绪 |
| 编辑和解释策略 | [agent](agent/README.md)：业务上下文与共享 Agent 启动 |
| 用户 SDK 如何定义与实现 | [sdk](sdk/README.md)：公开契约生成、选股/仓位/指标辅助及 Engine 适配 |
| 共享模拟和资源装配 | [execution](execution/README.md)：普通模拟与末日信号捕获；不承担正式报告流程 |
| 策略 runtime 的共同入口与资源归属 | [runtime](runtime/README.md)：start、metadata、execute、close 及唯一 Engine 适配 |
| TS 策略如何运行 | [runtime/typescript](runtime/typescript/README.md)：宿主 Engine、参数检查、SDK 装配与 isolate 收尾 |
| 策略共享沙箱协议 | [runtime/bridge.ts](runtime/bridge.ts) 与 [runtime/protocol.ts](runtime/protocol.ts)：元数据、快照、批量查询和指令重放；TS/Python 共用 |
| Python 策略如何协作 | [runtime/python](runtime/python/README.md)：会话协议与命令桥接，交易模拟仍由 TS Engine 执行 |

## 主要协作流程

回测提交检查用户与配置，在事务中保存配置、冻结 BacktestReport 并创建 Job；提交后唤醒队列。Worker 准备因子、选择语言 runtime、调用 Engine 并附加风险；结果由 Job 完成事务保存到报告和策略缓存。

扫描单独冻结配置／参数／日期范围，不覆盖草稿。父 Worker 准备一次因子，每个 cell 通过共享 runtime 在宿主运行 Engine；不经过正式回测风险后处理。Signals 也直接使用因子准备和信号捕获 runtime，三者不共享完整回测生命周期。

Agent 构造策略、指数和因子上下文后交给通用执行器；用户通过回测入口发起完整计算。Research [handoff](../research/handoff/README.md) 生成草稿，definitions 保存并处理冲突，也不自动回测。

## 模块入口与共同约束

[routes/index.ts](routes/index.ts) 导出 `strategyRoute`，组合 definition / agent / backtest / scan，挂载 `/api/app/strategies`；[共享请求契约](../../../../packages/shared/src/api/strategy.ts) 定义策略配置与 HTTP 输入；[schema.ts](schema.ts) 组合 Agent 的后端 SDK 引用校验。完整路径见 [路由设计](../../../../docs/design/api-route-naming.md#策略)，具体函数、输入输出与调用方见子能力说明。

Strategy 是可编辑定义，Report 是冻结证据，Job 是执行状态与日志。消费者用 jobId 轮询、reportId 读取结果；lastResult 只作当前缓存。自定义因子引用约束可见性，运行依赖按 research/deployment/signal 区分场景。低层 runtime 不负责数据库归属检查。

风险数据事实归 Market，模型历史要求归 Strategy；后处理异常按现有规则记录而不阻断主回测。进程／资源路径见 [运行清单](../../../../docs/backend-runtime-entries.md)，整体权限与事务用例在 [routes/index.integration.test.ts](routes/index.integration.test.ts)，算法和运行时测试就近链接。

架构规则见 [后端边界](../../../../docs/backend-boundaries.md)；历史实现／验收见 [Commit 8](../../../../docs/design/backend-architecture-refactor.md#78-commit-8-实现记录2026-09-09完成)、[服务边界设计](../../../../docs/design/core-business-service-boundaries.md) 和 [路由迁移验收](../../../../docs/design/api-route-naming.md#strategy-路由职责整理验收2026-09-10)。已退役的开发演示记录见 [历史清理](../../../../docs/design/backend-architecture-refactor.md#旧策略演示清理2026-09-09)。
