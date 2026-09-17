# 研究文档初始内容

[document-templates.ts](document-templates.ts) 的 `templateDefinition` 由 documents/createResearchDocument 调用，根据 blank、index_relationship 或 equity_fcff_valuation 返回标题与 CellSeed。这里生成源码数据，不查询市场、执行 Python 或保存数据库。

同文件 `legacyDefinition(title)` 用于旧 research 会话首次读取详情时补建初始 Cell；它是兼容入口，不应用到列表读取或已有文档。Cell 的 ID、排序和数据库创建映射由 documents/cell-seed 承担。

[FCFF](fcff/README.md) 有自己的参数、分类证据和案例规则，继续就地下沉；其他简单模板由本 README 覆盖。修改模板需对照 [文档创建测试](../documents/document-operations.test.ts)、[旧详情兼容测试](../documents/read.test.ts) 和相应 FCFF 测试，避免将模板示例误写为强制业务政策。

[返回 Research 总览](../README.md)
