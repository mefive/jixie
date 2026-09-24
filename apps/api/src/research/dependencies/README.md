# 变量依赖与失效规则

本目录回答“哪些 Cell 依赖这次修改、哪些已不能运行”，不执行 Cell 或拥有文档运行锁。

[analyze.ts](analyze.ts) 的 `analyzeResearchDocument(userId, documentId)` 是提案尝试流程的内部授权入口；内部 `analyzeAndPersist` 由全文运行调用，读取 Cell，经 `analyzeResearchCellSources` 使用共享 Python AST 分析，事务保存 definitions/references，再协调依赖问题。它会获取 Python 会话及写数据库，不能当作纯图计算。

[run-plan.ts](run-plan.ts) 的 `affectedResearchCellRunPlan`、`downstreamResearchCellIds` 及依赖冲突计算使用已分析的定义／引用，计算执行集合和顺序、检测重复定义与环；这些算法不取数、不运行 Python。受影响执行由 [document-runs](../document-runs/README.md) 消费计划。

[invalidation.ts](invalidation.ts) 的 `markDownstreamStale` 在上游改变后使已执行下游过期；`appendDeletedResearchCellDependencyIssues` 保存已删除上游定义来源并置 blocked；`reconcileResearchCellChanges`、`reconcileResearchCellDependencyIssues` 在内容协调后解除已恢复的阻塞。普通修改的 stale 与删除的 blocked 不可混用，reset 也不清除 blocked。

[runnable.ts](runnable.ts) 的 `assertResearchCellsRunnable`／`assertResearchCellIdsRunnable` 是执行前检查；[cell-values.ts](cell-values.ts) 只解析持久化数组／issue 值。内容编辑和提案应用是主要写入调用方，依赖层对 runtime 的调用属于会话资源使用，不反向调用 run-*。

改图算法看 [run-plan.test.ts](run-plan.test.ts)；改失效、删除或修订并发看 [执行生命周期测试](../document-runs/lifecycle.integration.test.ts)、[文档测试](../documents/document-operations.test.ts)。

[返回 Research 总览](../README.md)
