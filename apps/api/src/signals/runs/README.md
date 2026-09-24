# 信号运行与后台任务

这里拥有 SignalRun、signal Job 和冻结策略的单日捕获。用户入口是提交服务，批处理使用入队服务，JobService 调用注册的生命周期对象。

| 文件 / 入口 | 调用方与职责 |
| --- | --- |
| [submit.ts](submit.ts) `submitSignalRun` | run 路由传用户、deploymentId 和可选 tradeDate；缺日期时取最新已完成交易日，先全局结算再入队 |
| [enqueue.ts](enqueue.ts) `enqueueSignalRun` | submit 和 daily/scheduler；检查本人活动部署、交易日、基础数据及冻结因子的利率覆盖，返回运行标识及完成 Promise，准入失败抛出业务错误 |
| [job-lifecycle.ts](job-lifecycle.ts) `signalsRunLifecycle` | 校验 Job/Run 关联、启动 Worker，仅当前 attempt 可提交结果；运行状态从 Job 投影 |
| [read.ts](read.ts) `listDeploymentLatestRuns`、`listSignalRuns`、`getSignalRun`、`getSignalRunJob` | 本人列表和 Job 日志；`getSignalRun` 仅供成交更新响应内部读取；最新列表包含暂停部署及尚无运行的部署，不限制为今天 |
| [readiness.ts](readiness.ts) `signalCalendar`、`signalDataReady` | 入队的交易日／基础数据门槛，不同步数据 |

入队在事务中重查 active 状态。同部署同日 done 或 running 的运行直接复用；error/stale 复用 runId，清理结果与通知状态并创建新 Job，保留冻结依赖。新 Run 从部署冻结依赖。Run 与 queued Job 同事务，提交后唤醒队列，日志在执行开始时初始化。

[worker.ts](worker.ts) 接收 runId、调用 [runSignal](run.ts)、转发日志/结果，最后释放 Prisma 和 IPC。runSignal 加载 Run 和部署、准备因子源码、将部署和运行快照交给 Strategy 共享模拟，在因子初始化后、Engine 开始前核对完整血缘并捕获信号，最后补证券名称与因子摘要。部署 locale 保存在函数局部，失败在返回 worker 前翻译，保留原错误作为 cause；Worker 不重复翻译。函数不写账户快照，原 Job 完成事务保持。

任务通过 onSuccess 在终态事务里写运行结果；提交成功后依次等待 [账户初始化](../accounting/README.md) 和 [notifier.ts](notifier.ts) 的 `notifySignalRun`。初始化失败会阻止本次后续通知；这些步骤不与结果保存组成总事务，也没有 outbox 保证。通知结果由 notifier 写回 Run。

人工提交当前先全局结算、后在 enqueue 检查部署归属；不要把它写成用户部署范围内的结算。该边界已有 [设计记录](../../../../../docs/design/core-business-service-boundaries.md#6-单独记录不混入本次重构)。改权限和重试看 [路由集成测试](../routes/index.integration.test.ts)，改生命周期看 [Job 集成测试](../../../tests/job-lifecycle.integration.test.ts)，改通知看 [notifier.test.ts](notifier.test.ts)。

[返回 Signals 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：signalsRunJobPayloadSchema / SignalsRunJobPayload；入队与读取共用，IPC 子进程仍只接收 runId。
