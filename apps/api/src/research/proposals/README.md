# Cell 提案、审阅与尝试

Agent 先生成绑定修订的提案，用户审阅内容后再选择运行。接受提案不自动执行，attempt 也不等价于成功固化的全文 ResearchExecution。

| 文件 / 入口 | 主要调用方与职责 |
| --- | --- |
| [cell-changes.ts](cell-changes.ts) `prepareResearchCellChangeProposal` | Agent propose 工具；检查本人普通文档、修订、操作／源码限制，分析拟议源码并生成 diff，本阶段不修改 Cell |
| 同文件 `applyResearchCellChangeProposal`、`applyResearchCellChangeProposalForReview` | 明确应用或打开审阅；事务核对文档／修订并写内容和提案状态，协调依赖失效 |
| 同文件 `rejectResearchCellChangeProposal`、`acceptResearchCellChangeReview`、`revertResearchCellChangeReview` | proposal 路由；拒绝、接受或撤回，保留 document_running/document_changed 等冲突 |
| [attempts.ts](attempts.ts) `runResearchCellChangeProposalAttempt` | 用户明确提交尝试；检查提案状态和修订，记录 attempt，调用 document-runs/run-attempt |
| [review-state.ts](review-state.ts) `assertNoOpenCellChangeReview` | 执行入口仅需的窄查询，开放审阅阻止普通执行 |

提案含删除时不能自动走 for-review 应用，必须明确应用；开放审阅的接受／撤回要求当前内容仍匹配。撤回路径当前在事务内调用源码分析，不能描述为“所有 Python 都在事务外”；已有 [边界问题记录](../../../../../docs/design/core-business-service-boundaries.md#6-单独记录不混入本次重构)。

尝试区分 affected 和 clean_document，保存各 Cell 源码／输入模式快照，结果用于比较与 Agent 解释。[attempt-records.ts](attempt-records.ts) 查询和映射尝试；[attempt-context.ts](attempt-context.ts) 生成有界解释上下文。接受后何时执行以及完整证据准入分别看 [document-runs](../document-runs/README.md)、[evidence](../evidence/README.md)。

[change-records.ts](change-records.ts) 持久化提案并同步原 Agent 消息视图；[clarification-records.ts](clarification-records.ts) 的 `resolveResearchClarificationAnswer` 在事务中核对归属／答案及状态并更新消息，`clarification-message.ts` 生成后续提问文本。[series-validation.ts](series-validation.ts) 的 `validateResearchSeriesProposal` 检查允许导入及字面量数据身份／口径，依赖 catalog；它约束 Agent 拟议代码，不替代 SDK 运行校验。

改尝试看 [attempts.test.ts](attempts.test.ts)，改数据准入看 [series-validation.test.ts](series-validation.test.ts)，审阅冲突／记录同步看 [路由集成测试](../routes/index.integration.test.ts) 与 [执行生命周期](../document-runs/lifecycle.integration.test.ts)。

[返回 Research 总览](../README.md)
