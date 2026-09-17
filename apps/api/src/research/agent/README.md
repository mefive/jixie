# Research Agent 启动与文档上下文

[turn.ts](turn.ts) 的 `startResearchAgentTurn(userId, input, locale)` 供 agent 路由使用，返回 conversationId、turnId。已有会话须为本人未归档普通 research 会话；未传 ID 则先建会话。检查运行中 turn 后处理澄清回答，再读取文档、未完成澄清和已终结 attempt，构建工具与上下文并交给通用 Agent 入队；这些步骤没有合并为总事务。

存在 pending 澄清时不能绕过它发起普通消息。attemptId 必须属于该用户文档且已 success/error/cancelled；启动解释会先写 explanationTurnId，再 enqueue。SSE、取消、消息存储与模型循环仍归 [Agent](../../agent/README.md)。

[context.ts](context.ts) 的 `researchAgentDocumentContext` 根据选中 Cell 与依赖建立上下文、可编辑范围和附带源码快照；`compactResearchAgentHistory` 只压缩发给模型的历史，保留目标／已确认选择和近期信息，不删持久化对话。上下文有 Cell、源码、输出和历史长度上限，不能把未附带的任意 Cell 当作授权编辑对象。

Agent 的 catalog 证据供 [proposals](../proposals/README.md) 验证修改／澄清；执行仍由用户明确触发。改上下文看 [context.test.ts](context.test.ts)，改归属、澄清或 attempt 顺序看 [路由集成测试](../routes/index.integration.test.ts)。

[返回 Research 总览](../README.md)
