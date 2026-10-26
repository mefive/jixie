# 普通文档执行编排

普通执行由 HTTP 请求直接等待结果，不通过后台 Job。本能力负责授权、审阅检查、进程内文档互斥、修订保护和执行记录；Python 会话及协议归 [sandbox](../sandbox/README.md)。

| 文件 / 入口 | 消费者与执行范围 |
| --- | --- |
| [run-cell.ts](run-cell.ts) `runResearchCell` | execution 路由；本人单 Cell，检查开放审阅和 blocked 后取得文档锁 |
| [run-document.ts](run-document.ts) `runResearchDocument` | execution 路由；全文运行，clean 选项决定是否重置解释器并更新当前输出 |
| [run-affected.ts](run-affected.ts) `runAffectedResearchCells` | execution 路由；分析依赖，执行目标及受影响分支 |
| [run-attempt.ts](run-attempt.ts) `runResearchCellChangeAttemptPlan` | proposals/attempts；按已选定的尝试计划执行，记录归属 attempt |
| [control.ts](control.ts) `interruptResearchDocument`、`resetResearchDocumentRuntime` | execution 路由；前者取消并等待收尾，后者重置会话并使已执行且非 blocked 的 Cell stale |

单 Cell、全文、受影响分支和提案尝试共用 [run-state.ts](run-state.ts) 的 `startResearchDocumentRun`／`finishResearchDocumentRun`；锁只在当前进程，不是分布式互斥。执行入口通过 proposals/review-state 的窄查询拒绝开放审阅，不导入提案应用服务。

干净全文执行先分析依赖，将本次代码读入内存，重置会话后串行执行。错误或中断停止后续 Cell；结果回写使用 id/revision/source 条件，不能覆盖新修订。本次输入不另存为永久源码或环境快照。

[execute-plan.ts](execute-plan.ts) 按依赖跳过失败分支；[run-cell.ts](run-cell.ts) 保存当前输出、文档图片与有界运行诊断；[run-result.ts](run-result.ts) 返回文档、已执行 ID 和依赖。普通 Cell 再运行会清理该 Cell 不属于提案的旧终态诊断，提案尝试输出继续供审阅。没有正式 ResearchExecution 目录或封存。

interrupt 检查归属、标记停止、关闭活动 Python 会话，并等待 control.settled，确保执行记录和锁收尾后才返回。reset 有审阅检查，但沿用当前与执行的交互方式，不提供另一套取消协议。

改顺序／取消／快照看 [lifecycle.integration.test.ts](lifecycle.integration.test.ts)；改分支失败传播看 [execute-plan.test.ts](execute-plan.test.ts)；改 attempt 看 [proposals/attempts.test.ts](../proposals/attempts.test.ts)。

[返回 Research 总览](../README.md)
