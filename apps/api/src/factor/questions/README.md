# 私有因子问答

这里按用户与稳定 factorKey 保存独立问答，支持预置、模板、自定义和组合。它不修改原因子定义或作者草稿 messages，编辑入口另见 [agent](../agent/README.md)。

[conversations.ts](conversations.ts) 的 `startFactorQuestion` 由 Factor agent 路由传入 userId、解析后的 `FactorQuestionInput` 与 locale。路由检查消息长度、解析数据引用并补齐默认数组；业务在事务内校验来源／报告，创建或复用会话，保存用户消息、AgentTurn 和 contextSnapshot，再启动通用 runner；首个响应已有已提交消息和 turnId。客户端不提供可信 history，旧 factorName/history 请求需刷新。

[context.ts](context.ts) 的 `captureFactorQuestionContext` 固定已授权定义、源码哈希、选中报告摘要／内容指纹及可用快照。单轮 UTF-8 上下文超过 64 KiB 拒绝，不截断；问题最多 2,000 字符。嵌入分析仍走 [Research embedded](../../research/embedded/README.md) 的独立生命周期。

`readFactorQuestions` 返回本人历史、activeTurnId、nextBefore；默认最近 40 条，最多 100 条，before 按 sequence 向前分页。模型仅带最近 60 条历史和来源标签，本轮完整上下文单独装配。

questionFactorKey 不关联 Factor 外键；删除来源／报告不级联删除既有私有问答，但来源不可读时不能继续提问。失败、取消、中断只记录相应状态，不伪造成功消息。私有上下文不进入 SQL 白名单，来源公开也不会公开问答。

修改权限／上下文／持久化顺序看 [conversations.integration.test.ts](conversations.integration.test.ts)；存储演进看 [migration.integration.test.ts](migration.integration.test.ts)。设计与历史验收见 [嵌入分析记录](../../../../../docs/design/embedded-python-analysis.md)。

[返回 Factor 总览](../README.md)
