# 普通文档执行编排

普通执行由 HTTP 请求直接等待结果，不通过后台 Job。本能力负责授权、审阅检查、进程内文档互斥、修订保护和执行记录；Python 会话及协议归 [runtime](../runtime/README.md)。

| 文件 / 入口 | 消费者与执行范围 |
| --- | --- |
| [run-cell.ts](run-cell.ts) `runResearchCell` | execution 路由；本人单 Cell，检查开放审阅和 blocked 后取得文档锁 |
| [run-document.ts](run-document.ts) `runResearchDocument` | execution 路由；全文运行，clean 选项决定是否重置并创建冻结完整证据 |
| [run-affected.ts](run-affected.ts) `runAffectedResearchCells` | execution 路由；分析依赖，执行目标及受影响分支 |
| [run-attempt.ts](run-attempt.ts) `runResearchCellChangeAttemptPlan` | proposals/attempts；按已选定的尝试计划执行，记录归属 attempt |
| [control.ts](control.ts) `interruptResearchDocument`、`resetResearchDocumentRuntime` | execution 路由；前者取消并等待收尾，后者重置会话并使已执行且非 blocked 的 Cell stale |

单 Cell、全文、受影响分支和提案尝试共用 [run-state.ts](run-state.ts) 的 `startResearchDocumentRun`／`finishResearchDocumentRun`；锁只在当前进程，不是分布式互斥。执行入口通过 proposals/review-state 的窄查询拒绝开放审阅，不导入提案应用服务。

干净全文执行先分析并持久化依赖、读取源码快照、检查可运行性、创建 ResearchExecution，再 reset 会话并串行运行冻结 Cell；错误或中断停止后续 Cell，最后写完整执行状态并释放锁。中途编辑不会改变该次快照，结果回写使用 id/revision/source 条件，不能覆盖新修订。单 Cell、普通局部运行和 attempt 不产生等价的完整证据。

[execute-plan.ts](execute-plan.ts) 根据依赖跳过失败上游的下游，允许计划中的独立分支继续；[run-cell.ts](run-cell.ts) 负责输出／产物持久化及修订条件，[run-result.ts](run-result.ts) 只装配返回文档、已执行 ID 和完整执行摘要。Python 执行不包在一个跨全文的数据库事务里，Cell 开始、结果／产物和完整执行结束分别保存。

interrupt 检查归属、标记停止、关闭活动 Python 会话，并等待 control.settled，确保执行记录和锁收尾后才返回。reset 有审阅检查，但沿用当前与执行的交互方式，不提供另一套取消协议。

改顺序／取消／快照看 [lifecycle.integration.test.ts](lifecycle.integration.test.ts)；改分支失败传播看 [execute-plan.test.ts](execute-plan.test.ts)；改 attempt 看 [proposals/attempts.test.ts](../proposals/attempts.test.ts)。

[返回 Research 总览](../README.md)
