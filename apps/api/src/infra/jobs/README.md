# 后台任务设施

任务定义在各业务的 `*-job.ts`，不是 Job 数据行的子类。`defineJob()` 要求实现 parse、execute、complete、fail、recover，可选 afterCommit。新增任务需要实现完整契约并在 bootstrap 的 jobRegistry 注册；既有 factor kind 由 factor/factor-job.ts 分派 analysis/correlation，不更改持久化 payload。

| 文件 | 职责 |
| --- | --- |
| definition.ts | 强类型业务契约，闭包封装输入/结果，统一注册类型 |
| executor.ts | 执行、完成/失败事务、启动恢复与提交后异常边界 |
| queue.ts | FIFO、全局/用户并发、原子领取、唤醒、名额释放 |
| records.ts | Job 创建、查询和原子领取 |
| logs.ts | 内存日志、增量读取、持久化日志回读和五分钟淘汰 |
| worker-result.ts | Worker/子进程事件转为一次 Promise 结果，不写数据库 |

业务入口在事务中保存 Job 与关联实体，再初始化日志并唤醒队列。queue 向 executor.execute(jobId) 传递已领取的 Job。execute 校验持久化输入，在事务外运行计算，随后在短事务中保存业务结果和 Job 的状态/日志。complete/fail/recover 只能使用传入的 Prisma transaction client；业务不自行完成 Job，不在这些方法里调用外部服务。只有提交后才淘汰日志、执行 afterCommit。

parse/execute/complete 各阶段的异常统一进入失败事务。失败收尾也失败时，异常向队列传播并记录，名额仍释放；没有吞错后的假成功。提交后操作失败单独记录，不把已完成 Job 改成 error。信号的记账初始化失败会阻止后续通知，保留现有顺序；没有自动重试或 outbox。

recoverInterruptedJobs 在单一事务内调用所有注册定义的 recover，并将本批 running Job 标记 stale。各业务按数据库中自身的关联 ID 批量恢复；kind/payload 损坏不影响关联识别。queued 保持排队，不自动重试 running，不补造结果。完成与失败检查 Job 仍为 running，领域失败不覆盖已提交结果。

业务入口：strategy/backtest-job.ts、strategy/scan-job.ts、factor/analysis-job.ts、factor/correlation-job.ts、signals/signal-job.ts、research/curator-job.ts。没有仅为 complete/recover 建立的目录。回测是完整生命周期阅读示例。

所有任务的最终业务结果与 Job 共用完成事务。相关性 Worker 只计算并返回 payload，缓存 upsert 在 complete 内；Job 提交失败时新增缓存回滚、旧缓存保持不变。Curator 在事务外准备候选 findings，complete 在事务内重新按 owner/fingerprint 去重（含批内重复），批量保存 findings，再更新统计和 run 终态。任何最终写入失败都回滚本次结果；不再保留本轮部分 findings。Curator 初始 running 状态更新仍在准备阶段，计算、LLM 与文件检索都在完成事务外。

bootstrap 只注册定义、创建 executor，等待 Job/Agent/天气恢复，再启动队列与 HTTP。定义在调用 loader 时加载，执行不会由模块导入触发；CLI、buildApp 和未启动队列上的 wake 不会自行开始消费。

当前仍是单 API 调度进程，没有租约或多实例恢复协调。没有完整 stop/drain、启动失败资源回收和退出信号协议，HTTP listener 也未通过 startServer 返回。afterCommit 没有持久化重试，崩溃前内存日志可能丢失。Worker 正常完成须等到退出；运行失败和异常退出通过 Promise 传递，数据库操作不在事件回调中执行。

本 session 开工前预告 commit message，代码完成先通过 lint/typecheck 等静态检查，再交人工 review；review 通过后做测试及运行验证，全部通过后直接提交。相关测试：job-lifecycle.integration.test.ts、bootstrap.test.ts、infra/jobs/*.test.ts。事务测试使用全新临时 SQLite，结束断开连接并删除自身 fixture；计算、通知、记账初始化与 LLM 使用替身；Curator 领域测试同时覆盖候选准备失败不发布部分结果。当前版本人工 review、根级 typecheck、32 个 TS 文件 lint、完整 API 测试（191 文件/1020 项）、干净构建及源码/编译后启动 smoke 均通过。临时进程、端口和数据库连接已释放。
