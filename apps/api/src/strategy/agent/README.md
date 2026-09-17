# 策略 Agent 启动与上下文

[turn.ts](turn.ts) 的 `startStrategyAgentTurn` 供 [agent 路由](../routes/agent.ts) 使用。接收用户、策略 ID、消息、当前代码、语言与可选报告／数据引用，返回 turnId。

入口解析 schema 后检查本人策略和运行中 turn；随后并行读取 [context.ts](context.ts) 的 `syncedIndexContext`、`publishedFactorContext`，捕获服务端嵌入上下文，构造 Strategy profile 并交给通用 Agent。上下文读取会查询数据；整个准备和入队没有包成一个总事务。

当前编辑代码可由请求传入；嵌入分析的宿主／报告授权和保存代码快照由 [Research embedded](../../research/embedded/README.md) 负责。Agent 负责生成／解释及既有校验，不提供策略配置保存或后台回测工具；完整回测由用户通过 [backtests](../backtests/README.md) 发起。Research 生成 Strategy 草稿也不自动回测。

SSE、取消、历史消息和通用模型循环见 [Agent 总览](../../agent/README.md)。修改归属、忙碌或上下文装配看 [路由集成测试](../routes/index.integration.test.ts)；修改提示词和编写接口看两种 [TS](../runtime/typescript/README.md)／[Python](../runtime/python/README.md) 运行能力及其提示词测试。

[返回 Strategy 总览](../README.md)
