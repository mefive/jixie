# 正式回测与冻结报告

本能力拥有 BacktestReport、回测 Job、完整语言编排与风险后处理。交易循环归 [Engine](../../engine/README.md)，参数扫描有 [独立流程](../scans/README.md)。

| 文件 / 入口 | 主要调用方与结果 |
| --- | --- |
| [submit.ts](submit.ts) `submitStrategyBacktest` | backtest 路由传 userId、config、strategyId、locale；返回 jobId/reportId |
| [reports.ts](reports.ts) `listStrategyBacktestReports`、`readStrategyBacktestReport` | 读取本人成功且有 payload 的冻结报告；不从 Strategy.lastResult 拼装历史 |
| 同文件 `findActiveStrategyBacktestJob`、`readStrategyBacktestJob` | 活动恢复／日志轮询；active 包含 queued/running，返回 ID 对或 null，日志保留 since 游标并检查 kind 和归属 |
| [job.ts](job.ts) `backtestJob` | 通用执行器的 backtest 定义；拥有解析、线程执行、完成／失败／恢复 |
| [run.ts](run.ts) `runConfiguredBacktest` | 仅回测 Worker 调用；config 和用户上下文 → 完整计算结果，选择 TS/Python、附加因子血缘与风险 |

## 顺序与事务

submit 先校验日期，再在事务内检查所有者、活动任务、保存配置并创建冻结报告 + queued Job；提交成功后才初始化日志和唤醒队列。配置保存采用实际名称，创建任一记录失败不能唤醒队列。

Job 校验 payload 的用户与报告关联，启动 [worker.ts](worker.ts)。Worker → run → [因子准备](../factor-inputs/README.md) → 对应语言 runtime / Engine → [risk](../risk/README.md)。TS 使用墙内模拟；Python 仍使用 TS Engine，并在 finally 关闭因子宿主和 Python runtime。风险后处理失败只记日志，不阻断主回测。

线程结果到达且正常退出后，Job execute 尽力刷新策略名，再产生结果哈希；complete 使用执行器提供的 transaction 保存报告、Strategy.lastResult 和 Job 终态。失败报告为 error，启动恢复中断报告为 stale。lastResult 是缓存，不能代替不可混淆的 reportId 读取。

改提交／报告看 [路由集成测试](../routes/index.integration.test.ts)、[backtest.test.ts](../routes/backtest.test.ts)；生命周期看 [Job 集成测试](../../../tests/job-lifecycle.integration.test.ts)；语言与资源看各 runtime 测试。源码 boot／编译 worker 路径以 [运行清单](../../../../../docs/backend-runtime-entries.md) 为准。

[返回 Strategy 总览](../README.md)
