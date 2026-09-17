# 冻结研究交接到业务草稿

[factor-drafts.ts](factor-drafts.ts) 的 `createResearchFactorDraft` 与 [strategy-drafts.ts](strategy-drafts.ts) 的 `createResearchStrategyDraft` 是 evidence 路由的交接入口，接收 userId、executionId 和 locale，返回目标草稿。

顺序必须保持：先调用目标模块 definitions/from-research 的 find 入口按用户与源执行找已有草稿；命中直接复用，不再次读取证据或调用模型。未命中再通过 evidence 读取本人普通文档的成功且已固化执行，调用 [factor-handoff.ts](factor-handoff.ts) 的 `generateResearchFactorDraft` 或 [strategy-handoff.ts](strategy-handoff.ts) 的 `generateResearchStrategyDraft`，组装来源元数据，然后委托目标模块保存。

[context.ts](context.ts) 的 `researchHandoffContext` 从冻结执行生成有界模型上下文，不读取当前可编辑 Cell 替代。Research 拥有准入错误、模型生成和来源说明；Factor / Strategy 拥有命名、默认值、写入和唯一冲突重试。传给目标的是生成后的数据，没有跨模型调用的总事务或生成器回调。

成功交接只创建私有草稿，不自动启动 Factor 评估或 Strategy 回测。目标差异见 [Factor definitions](../../factor/definitions/README.md)、[Strategy definitions](../../strategy/definitions/README.md)，嵌入执行需先接续为普通文档并取得合格证据，不能直接绕过固化门槛。

改复用、授权和元数据看 [factor-drafts.test.ts](factor-drafts.test.ts)、[strategy-drafts.test.ts](strategy-drafts.test.ts)；改生成准入看 [factor-handoff.test.ts](factor-handoff.test.ts)、[strategy-handoff.test.ts](strategy-handoff.test.ts)。

[返回 Research 总览](../README.md)
