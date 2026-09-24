# 后台任务

业务实现 `JobLifecycle<Result>` 契约，导出带具名方法的普通对象。`JobService.register` 显式注册，
`JobService.execute` 推进生命周期；业务不实例化 class，不创建阶段函数闭包，也不自行提交 Job 终态。

| 文件 | 职责 |
| --- | --- |
| lifecycle.ts | onExecute、onSuccess、onFailure、onInterrupted、onCommitted 契约 |
| service.ts | JobService 的注册、存储、执行、终态事务、启动恢复和 CLI 完成观察 |
| register.ts | 七类业务对象的显式注册；无导入时副作用，不执行任务 |
| scheduler.ts | JobScheduler 单例：FIFO 条件领取、全局/用户并发名额、退出后唤醒 |
| logs.ts | JobLogs 单例：执行时初始化、日志增量、终态冻结与五分钟淘汰 |
| worker.ts | WorkerRun 的资源所有权、消息解析、终止与实际退出等待 |

## 生命周期与事务

- `onExecute(job, log)` 必须实现。在事务外解析持久化输入、运行计算，返回类型化结果。
- `onSuccess(transaction, job, result)` 可选。在同一事务保存业务产物与 Job.done。
- `onFailure(transaction, job, error)` 可选。在同一事务保存业务失败信息与 Job.error。
- `onInterrupted(transaction, job)` 可选。在 API 启动恢复事务中清理领域记录，与 Job.stale 一起提交。
- `onCommitted(job, status)` 可选。done/error 提交后执行通知等操作；失败仅记录，不改写已提交的终态。

终态事务先条件更新仍 running 的 Job，失去终结资格时不调用业务写入；任何写入异常都回滚。
onExecute 返回即由服务推进完成，不再要求业务手动 finishJob。完成事务异常走失败收尾；
失败持久化也失败时抛出保留两个原因的 AggregateError。queued 不参与启动中断恢复。

注册可指定一个持久化关联字段。失败、中断和提交后动作同时检查 kind 与真实关联，并对生命周期去重；
Embedded 即使 kind/payload 损坏，仍按 researchExecutionId 清理 activeRunId。
通用 service/scheduler/logs/worker 不导入业务；只有 register.ts 装配业务对象，生产调用方仅 bootstrap 和每日信号批处理。

## 阅读回测链路

`strategy/backtests/submit.ts` 同事务保存冻结报告和 queued Job，提交后 `JobScheduler.wake()`。
调度器 `JobService.claim` 领取 queued → running，再调用 `JobService.execute(jobId)`。
服务初始化日志并调用 `strategyBacktestLifecycle.onExecute`：校验输入、并发执行策略命名与 Worker，等待二者收尾，返回结果。
服务在终态事务调用 onSuccess，保存报告、hash、computedAt、Strategy.lastResult 与 Job.done。
日志提交后冻结，五分钟淘汰后从数据库回读。Worker 真正退出、提交后操作结束后才释放并发名额。

## 七类业务

- `strategy/backtests/job-lifecycle.ts`：回测结果及 Strategy.lastResult。
- `strategy/scans/job-lifecycle.ts`：扫描结果；同一 Worker 线程串行运行各组合，不创建 cell 子进程。
- `factor/evaluations/job-lifecycle.ts`：分析结果；onFailure 仅为 Worker 错误保存本地化 failureMessage。
- `factor/correlations/job-lifecycle.ts`：成功 upsert 缓存；失败保留上次成功缓存。
- `signals/runs/job-lifecycle.ts`：最新 attempt 才能发布结果；onCommitted 再检查当前 attempt，成功时先会计再通知，失败时仅通知。
- `research/embedded/job-lifecycle.ts`：领域结果、证据与首次成功冻结；失败/中断按持久化关系清理。
- `research/curator/job-lifecycle.ts`：提交时重查 owner/fingerprint，findings 与统计整体保存。

有 Job 的报告从 Job 投影状态；历史无 Job 终态回读 nullable legacyStatus/legacyError。
Factor 保留 failureMessage。ResearchExecution/CellExecution 为领域结果，Job.done 与 execution.error 可以同时成立。
Signals 最新 attempt 按 createdAt desc、id desc。旧 attempt 不能覆盖新结果。

## 启动和 CLI

bootstrap 显式 registerJobLifecycles，等待 Job、Agent、天气恢复，再调用
JobScheduler.initialize(JobService.execute)、JobScheduler.wake，最后监听 HTTP。buildApp 和导入模块不消费任务。

Signals/Maintenance CLI 每日循环只注册生命周期。创建或复用 Job 后，条件 claim 并直接 await JobService.execute，
claim 失败就等待已有执行者完成。CLI 不初始化 scheduler、不执行全局恢复，不依赖 API 在线；串行执行独立于 API 并发名额。
API 提交仍唤醒本进程 scheduler；初始化前 wake 无操作，重复 initialize 报错。
完成观察会查询数据库，但不派发任务。调度器没有定时数据库轮询。崩溃前未持久化日志仍可能丢失。

JobLogs 的静态 initialize 初始化单个 Job 日志；私有唯一实例持有缓冲和淘汰定时器，无需依赖注入。
WorkerRun 是每次 runWorker 的资源所有者，不参与业务注册。

## 验证状态

2026-09-24：静态检查、迁移升级、七类任务回归、真实源码/编译 Worker 与构建已通过。
完整审阅与验证记录见 `docs/design/job-system-simplification.md`。

## Worker 消息契约

五个 Worker 任务的消息 schema 位于各业务的 worker-protocol.ts，发送端使用 schema 推导类型，
接收端调用同一 schema 的 parse。jobs/worker-protocol.ts 仅共享 log/error 信封，不拥有业务结果。
回测、扫描与 Signals 的完整结果校验位于各自 result-schema.ts，和 shared/engine 类型做完整结构检查。
扫描 cell 子进程也共享结果协议；非法消息终止子进程并等待 close 后再失败。
Factor execution 的协议同时供正式评估和 Weather 使用，仍传输 JSON 字符串结果。
Embedded 和 Curator 直接调用领域执行函数，没有新增 Worker 协议层。

## Job 与 Worker 输入契约

七类业务各自的 job-payload.ts 同时导出 schema 和派生类型。提交端用派生类型约束对象，生命周期从
持久化 JSON 读取时调用同一 schema。schema 文件不导入生命周期执行代码。

回测与扫描 Worker 输入通过 Job schema 的 omit 派生，相关性 Worker 直接消费同一 Job schema。
Factor 公共计算输入位于 factor/execution/worker-input.ts，支持正式研究 spec 与天气分析 spec；
evaluations/job-payload.ts 在此基础上增加 failedMessage 并保留正式任务既有的 spec 规范化。
四类 Worker 在 try/catch/finally 中解析输入，非法输入发出 error 并执行资源清理。
Signals 子进程仍只接收 runId，两个 Research 任务直接调用领域函数。

扫描基础 spec 和参数值 schema 与 HTTP/结果协议共用；HTTP 继续单独施加维度、值数量及字符串限制，
持久化读取不因此收紧。契约回归见 apps/api/tests/job-payload.test.ts，真实 Worker 输入失败/退出覆盖见
apps/api/tests/factor-worker.integration.test.ts，源码与编译入口均已通过验证。
