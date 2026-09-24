# 参数扫描

扫描比较冻结配置下的参数、仓位或资金规模组合，拥有 StrategyScanReport 与 strategy-scan Job；不保存当前草稿，也不为每个 cell 创建 BacktestReport。

| 文件 / 入口 | 使用方式 |
| --- | --- |
| [parameters.ts](parameters.ts) `inspectStrategyScanParameters` | scan 路由传源码／语言，AST 静态解析后返回参数；Python 扫描拒绝 |
| [submit.ts](submit.ts) `submitStrategyScan` | 路由传用户、配置／spec、strategyId 和 locale；冻结参数、交易日范围、截止日，返回 jobId/reportId |
| [reports.ts](reports.ts) `listStrategyScanReports`、`readStrategyScanReport`、`findActiveStrategyScanJob`、`readStrategyScanJob` | 列表含各状态、最多 50 条；活动和日志以 Job ID 查询，报告详情使用 reportId |
| [scan.ts](scan.ts) `normalizeScanSpec`、`parameterCombinations`、`scanCellOverrides`、`metricSummary`、`rebaseNav` | 规格、参数组合、覆盖值与摘要的纯计算，组合上限由本文件维护 |
| [strategy-scan-lifecycle.ts](strategy-scan-lifecycle.ts) `strategyScanLifecycle` | 解析输入、装配父 Worker，通过 onSuccess 原子保存结果 |

提交先检查语言／日期、静态参数声明和样本内外交易日范围，再开事务校验归属、活动任务并创建 Report + Job，提交后唤醒。这个事务不覆盖之前的源码检查和交易日查询。

[strategy-scan-worker.ts](strategy-scan-worker.ts) 校验输入、转发日志与结果，并调用 [runStrategyScan](run.ts)，最后断开 Prisma。runStrategyScan 准备一次因子源码，直接循环参数组合，在同一线程中串行调用 [runSandboxedBacktest](../execution/simulation.ts) 完成各区间回测并汇总。每次模拟拥有并释放自己的策略与因子 runtime；scan.ts 仅提供纯计算。不经过正式回测的风险后处理。

扫描不再为 cell 启动子进程，也没有专用执行器或 stop 消息。Job lifecycle 使用普通 Worker 和通用 runWorker；异常终止等待线程退出，不覆盖 worker.terminate。失去逐 cell 进程退出带来的强制内存回收，因此源码及编译入口回归覆盖同一线程连续运行、正常退出和异常终止。

改网格／指标看 [scan.test.ts](scan.test.ts)，改循环顺序、区间和资金覆盖看 [run.test.ts](run.test.ts)；改冻结／状态查询／权限看 [路由集成测试](../routes/index.integration.test.ts)；Job 收尾看 [生命周期测试](../../../tests/job-lifecycle.integration.test.ts)；参数运行规则看 [TypeScript runtime](../runtime/typescript/README.md)。

[返回 Strategy 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：strategyScanJobPayloadSchema / StrategyScanJobPayload；Worker 输入派生子集，spec 与 HTTP 复用基础结构，HTTP 保留额外限制。

参数识别由 [inspect-parameters.ts](inspect-parameters.ts) 独立实现，表单和提交共用。只读取默认导出策略的内联字面量 params，不执行源码。支持规则见[公开帮助](../../../../docs/src/content/help/zh/backtesting/parameter-scan.md)；运行时 metadata 校验与参数覆盖仍在 sandbox 中执行。
