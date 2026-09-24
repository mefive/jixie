# 因子相关性缓存与任务

相关性按用户、规范化因子集合、频率和区间寻址缓存，产物是 FactorCorrelation，不创建 FactorReport。HTTP 入口在 [routes/correlation.ts](../routes/correlation.ts)。

[operations.ts](operations.ts) 提供 `readFactorCorrelation`、`findActiveFactorCorrelationJob`、`submitFactorCorrelation`、`readFactorCorrelationJob`。消费者传 userId、keys、freq、start/end 及 locale；提交另带 refresh。键先 trim／去重，数量为 2–8，内置键直接识别，自定义键按现有 ID 与用户归属查询。

提交先检查区间及权限；未强制刷新时优先返回 `{ done: true, report }` 缓存，否则复用 queued/running Job 或创建新 Job，返回 `{ jobId }`。缓存读取和活动查询不能被描述为拥有独立报告 ID。缓存检查、活动查询与 createJob 没有包在一个总事务里，不宣称并发提交已由全链路锁保护。

[job-lifecycle.ts](job-lifecycle.ts) 的 `factorCorrelationLifecycle` 注册为 factor-correlation，校验 payload 用户且不得关联 FactorReport。[worker.ts](worker.ts) 调用 [compute.ts](compute.ts) 的 `computeFactorCorrelation`，只复用 [横截面数据与序列](../execution/cross-sectional/README.md)，最后断开 Prisma。主线程通过 onSuccess 在终态事务中 upsert 缓存；失败／恢复保留上次成功缓存，由 jobs/service 更新 Job。

任务读取经 [jobs](../jobs/README.md) 校验用户、独立 kind 和无报告关联，不能用它读取 holdout 日志。源码／编译 Worker 路径见 [运行清单](../../../../../docs/backend-runtime-entries.md)。

修改键规范化、缓存优先和任务复用看 [路由集成测试](../routes/index.integration.test.ts)；完成／恢复看 [Job 集成测试](../../../tests/job-lifecycle.integration.test.ts)；因子序列规则看 [series.test.ts](../execution/cross-sectional/series.test.ts)。

[返回 Factor 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：factorCorrelationJobPayloadSchema / FactorCorrelationJobPayload；提交、生命周期和 Worker 共用同一输入契约。
