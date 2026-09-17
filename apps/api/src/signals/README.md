# Signals 后端阅读地图

业务错误统一在 [errors.ts](errors.ts) 定义，调用点直接抛出模块错误；HTTP 分类与翻译由公共边界完成。约定及例外见 [错误设计](../../../../docs/design/api-errors.md)。

Signals 从成功回测报告创建独立部署，按收盘数据产生下一交易日指令，再记录模拟／人工成交和账户差异。当前支持范围由部署入口的 TS、股票／ETF 准入控制，不连接券商自动下单。

## 按业务问题进入

| 要找什么 | 子能力与责任 |
| --- | --- |
| 从报告部署、暂停、查询部署 | [deployments](deployments/README.md)：冻结配置／因子依赖，同报告活动去重 |
| 手工生成、历史／最新运行、进度与通知 | [runs](runs/README.md)：日期准入、幂等重试、Run + Job、IPC Worker 和完成后动作 |
| 模拟结算、人工成交和账户对比 | [accounting](accounting/README.md)：基线、逐日事务、成交写入与纯重放 |
| 冻结因子是否变化、需要哪些利率 | [factor-inputs](factor-inputs/README.md)：依赖比较、摘要及新鲜度政策 |
| 每日数据准备与批量运行 | [daily](daily/README.md)：按部署需求同步，再串行入队和等待 |

## 主要协作流程

部署从本人完成回测报告冻结配置，使用 [Strategy factor-inputs](../strategy/factor-inputs/README.md) 检查 deployment 场景。后续策略草稿变化不影响部署，不同报告可同时 active。

手动运行由 submit 选择日期、先结算账户再入队；Maintenance 数据发布后调用每日生成，CLI 则先同步所需数据。二者共用 enqueue，在事务内创建／复用 Run 和 Job，提交后唤醒队列。

Job 启动 IPC Worker，按 signal 场景准备因子并比较冻结血缘，调用 Strategy 墙内信号捕获和 Engine，返回指令、模型账户及输入摘要。主线程提交结果后初始化记账，再通知；后续结算和人工回填分别更新 simulation/actual 账户。

## 模块入口与共同约束

[routes/index.ts](routes/index.ts) 导出 `signalsRoute`，组合 deployment / run / execution，挂载 `/api/app/signals`；[共享请求契约](../../../../packages/shared/src/api/signals.ts) 定义 HTTP 输入，[schema.ts](schema.ts) 组合信号提交的内部业务类型。latest-runs 包含本人所有部署的最新结果、暂停及暂无运行项，不加今天过滤。Run 与 Job 分离，日志按 jobId 查询；完整路径见 [路由设计](../../../../docs/design/api-route-naming.md#剩余模块路由整理2026-09-11)。

同部署同日失败重试保留 runId、创建新 Job；冻结血缘不随重新准备被覆盖。暂停保留运行／账户，重新部署产生新实例。资源所有者检查、状态转换与事务分别归对应能力；结果提交、账户初始化和通知不组成总事务，人工成交写入与实际账户重放也分开。

Market 提供行情、日历与可得日期，Signals 决定业务准入和所需同步；不能把 Market 数据事实写成 Signals 政策。[cli/run-signals.ts](cli/run-signals.ts) 仅是每日能力的命令适配，用法见 [命令索引](../../scripts/README.md)。IPC 与源码／编译路径见 [运行清单](../../../../docs/backend-runtime-entries.md)。

整体权限／事务场景看 [routes/index.integration.test.ts](routes/index.integration.test.ts)，算法与记账测试见子文档。设计及历史验收见 [每日信号设计](../../../../docs/design/daily-signals.md)、[Commit 9](../../../../docs/design/backend-architecture-refactor.md#79-commit-9-实现记录2026-09-09)、[服务边界及已记录限制](../../../../docs/design/core-business-service-boundaries.md)。依赖约束见 [后端边界](../../../../docs/backend-boundaries.md)。
