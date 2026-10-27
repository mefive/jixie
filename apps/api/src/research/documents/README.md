# 文档与 Cell 内容

这里拥有普通研究文档的创建、查询、编辑和归档；不执行 Cell。普通入口排除嵌入分析的内部文档，后者由 [embedded](../embedded/README.md) 管理。

| 文件 / 入口 | 使用方式与副作用 |
| --- | --- |
| [read.ts](read.ts) `listResearchDocuments` | document 路由；按本人 research 会话的 active/archived 状态查询，映射消息摘要与 Cell 计数，**不补建文档** |
| 同文件 `getResearchDocument` | 路由及编辑／执行返回视图；检查本人未归档普通会话，组装 Cell、消息、审阅与尝试；旧会话第一次详情读取会用 legacyDefinition 补建文档和 Cell |
| [document-operations.ts](document-operations.ts) `createResearchDocument` | 空白初始内容 → 同一事务创建会话、文档和 Cell，再返回详情 |
| 同文件 `renameResearchDocument`、`deleteResearchDocument`、`restoreResearchDocument` | 保留会话归属／归档条件及级联删除；删除成功后关闭 Python 会话，没有新增运行中删除保护 |
| [archive-idle-document.ts](archive-idle-document.ts) `archiveIdleResearchDocument` | HTTP 归档入口：归属检查后拒绝文档执行或 Agent turn 运行中，再调用 document-operations 的 `archiveResearchDocument` 归档并关闭会话；底层 archive 不重复这一忙碌检查 |
| [cell-operations.ts](cell-operations.ts) `addResearchCell`、`updateResearchCell`、`deleteResearchCell` | document 路由；处理排序、修订冲突和内容事务，再协调依赖失效／删除阻塞 |
| [from-backtest-report.ts](from-backtest-report.ts) `createResearchDocumentFromBacktestReport` | 检查本人成功且有结果的报告，事务创建带报告来源的研究文档，不重跑回测 |

HTTP 创建只接受 blank 模板或 backtest-report source，空对象建立空白文档；输入契约位于 shared/api/research。专用模板请求被拒绝。[initial-content.ts](initial-content.ts) 提供空白文档及旧会话首次详情读取的初始内容，不执行计算。[cell-seed.ts](cell-seed.ts) 是初始内容与旧会话补建共用的创建映射。[execution-source.ts](execution-source.ts) 的 `loadResearchRunInput`、`loadExecutableResearchCell` 供运行层读取有归属条件的源码；前者只提供本次全文运行的内存输入，不生成历史证据。

改读取兼容看 [read.test.ts](read.test.ts)；改生命周期看 [document-operations.test.ts](document-operations.test.ts) 与 [路由集成测试](../routes/index.integration.test.ts)；改报告导入看 [from-backtest-report.test.ts](from-backtest-report.test.ts)。编辑后状态规则见 [dependencies](../dependencies/README.md)。

[返回 Research 总览](../README.md)
