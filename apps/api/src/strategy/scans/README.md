# 参数扫描

扫描比较冻结配置下的参数、仓位或资金规模组合，拥有 StrategyScanReport 与 strategy-scan Job；不保存当前草稿，也不为每个 cell 创建 BacktestReport。

| 文件 / 入口 | 使用方式 |
| --- | --- |
| [parameters.ts](parameters.ts) `inspectStrategyScanParameters` | scan 路由传源码／语言，隔离检查后返回参数；Python 扫描拒绝 |
| [submit.ts](submit.ts) `submitStrategyScan` | 路由传用户、配置／spec、strategyId 和 locale；冻结参数、交易日范围、截止日，返回 jobId/reportId |
| [reports.ts](reports.ts) `listStrategyScanReports`、`readStrategyScanReport`、`findActiveStrategyScanJob`、`readStrategyScanJob` | 列表含各状态、最多 50 条；活动和日志以 Job ID 查询，报告详情使用 reportId |
| [scan.ts](scan.ts) `normalizeScanSpec`、`executeStrategyScan`、`scanCellOverrides` | 规格、组合与摘要；execute 接收 run 回调串行遍历，无数据库或 fork 依赖，组合上限由本文件维护 |
| [strategy-scan-lifecycle.ts](strategy-scan-lifecycle.ts) `strategyScanLifecycle` | 解析输入、装配父 Worker，通过 onSuccess 原子保存结果 |

提交先检查语言／日期、隔离参数和样本内外交易日范围，再开事务校验归属、活动任务并创建 Report + Job，提交后唤醒。这个事务不覆盖之前的源码检查和交易日查询。

[strategy-scan-worker.ts](strategy-scan-worker.ts) 在启动第一个 cell 前按 research 场景调用一次 `prepareStrategyFactors`，只取 modules。每个 cell fork [strategy-scan-cell-worker.ts](strategy-scan-cell-worker.ts)，直接执行 `runWalledBacktest`；父线程收到结果且子进程正常退出后才继续。扫描不经过 backtests/run，不附加正式回测风险后处理。父线程和 cell 各自释放数据库等资源；运行路径见 [清单](../../../../../docs/backend-runtime-entries.md)。

改网格／指标看 [scan.test.ts](scan.test.ts)；改冻结／状态查询／权限看 [路由集成测试](../routes/index.integration.test.ts)；Job 收尾看 [生命周期测试](../../../tests/job-lifecycle.integration.test.ts)；参数运行规则看 [TypeScript runtime](../runtime/typescript/README.md)。

[返回 Strategy 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：strategyScanJobPayloadSchema / StrategyScanJobPayload；Worker 输入派生子集，spec 与 HTTP 复用基础结构，HTTP 保留额外限制。
