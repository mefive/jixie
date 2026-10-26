# 因子任务归属查询

[read.ts](read.ts) 的 `readOwnedFactorJob` 检查任务所属用户、kind 与关联报告，不能通过异常的跨用户关系绕过报告权限。

HTTP 使用 `readFactorAnalysisJob`。结果和日志可由本人直接读取，生命周期与计算归各业务目录。

验证见 [Factor HTTP 边界](../routes/index.integration.test.ts)。
