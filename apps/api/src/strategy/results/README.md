# Strategy 结果保留

`pruneStrategyResults` 在提交、Job 终态和启动接收请求前执行。按用户／策略，回测与扫描各保留最近提交及活动任务；旧报告删除时级联清理 Job／日志。失败的新提交不恢复旧结果，旧 ID 返回不存在。

迁移保留原物理 `config` JSON 列，Prisma 字段改为 `settings`；启动事务将幸存的旧 JSON 去除源码并记录输入摘要。新报告直接保存无源码 settings，摘要仅用于 `needsRerun`，不作为证明或源码恢复协议。已发布 Factor 的版本绑定不受影响。

`finishStrategyJob` 在成功、失败、中断和恢复事务中清除 Job.payload，再执行保留规则。活动 Job 保存完整输入以支持排队重启；Worker 只在内存中使用它。报告保存实际参数、结果和状态，不复制源码。Strategy 的 HTTP `lastResult` 从最近报告读取，数据库不另存缓存。

测试准备见 `retention.integration.test.ts` 和 `tests/strategy-results-migration.test.ts`；上线前备份，历史清理不可逆。
