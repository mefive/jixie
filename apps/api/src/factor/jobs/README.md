# Factor Job 归属查询

[read.ts](read.ts) 的 `readOwnedFactorJob` 是内部查询支撑入口，接收 userId、jobId、指定 kind 和日志游标 since，返回通用 Job 视图或 null。

它检查用户与独立 kind；factor-analysis 还要求关联本人报告，factor-correlation 要求没有报告关联。主要消费者是 [evaluations/read.ts](../evaluations/read.ts) 和 [correlations/operations.ts](../correlations/operations.ts)。

**该入口不隐藏 holdout 日志。** HTTP／业务读取分析任务应调用 `readFactorAnalysisJob`，由它在归属校验后执行封存；相关性读取用 `readFactorCorrelationJob`。不要为了省一次跳转直接把低层返回值暴露给用户。

任务生命周期分别归 [evaluations](../evaluations/README.md)、[correlations](../correlations/README.md)，队列归 Infra。旧 kind 的停服转换及回退要求只在 [运行入口清单](../../../../../docs/backend-runtime-entries.md#factor-job-kind-转换) 维护，普通启动不执行迁移。

修改查询条件看 [路由集成测试](../routes/index.integration.test.ts) 中跨用户、跨 kind 和 holdout 日志隔离场景。

[返回 Factor 总览](../README.md)
