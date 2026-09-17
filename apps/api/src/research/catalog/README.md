# 数据发现与语义绑定

[data-catalog.ts](data-catalog.ts) 的 `searchResearchDataCatalog` 供 data 路由、Agent 搜索工具和提案校验使用，按 query、assetType、scope、limit 返回可发现的证券、数据集和方法信息；会查询已有市场数据，但不触发同步。

[capabilities.ts](capabilities.ts) 的 `researchCapabilityCatalog` 描述可调用能力和 measure；[concepts.ts](concepts.ts) 定义业务概念与选择维度；[concept-bindings.ts](concept-bindings.ts) 把概念连接到具体身份、SDK 调用及数据契约。[concept-binding-resolver.ts](concept-binding-resolver.ts) 的 `resolveResearchConceptBindings` 根据请求和来源政策返回可用绑定，`researchBindingAllowed` 是准入判断，不把所有同名概念当可互换产品。

[source-decisions.ts](source-decisions.ts) 记录来源选择／限制，引用 [datasets 数据契约](../datasets/cross-market-data-contracts.ts)；[playbooks.ts](playbooks.ts) 提供研究方法说明。Market [registry](../../market/registry/README.md) 才是跨模块证券／曲线／FX 共享身份的维护位置，不能在 catalog 再建供应商同步定义。

Agent 提案依赖目录验证受控字面量身份，运行请求仍由 SDK 校验并取数。改变可发现性或语义约束需查看 [data-catalog.test.ts](data-catalog.test.ts)、[concept-binding-resolver.test.ts](concept-binding-resolver.test.ts)、[concept-bindings.test.ts](concept-bindings.test.ts) 及各同名 registry 测试，并对照 [提案校验](../proposals/series-validation.ts)。

[返回 Research 总览](../README.md)
