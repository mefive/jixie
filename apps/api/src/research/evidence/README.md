# 冻结执行与私有产物

本能力保存可回看、可固化的研究事实，不控制 Python 会话或文档运行锁。普通干净全文运行由 [document-runs](../document-runs/README.md) 发起；嵌入分析使用自己的冻结流程。

[execution-records.ts](execution-records.ts) 的 `createResearchExecution` 接收已冻结的标题、contentRevision、runtimeVersion 和 Cell 源码集合，在事务中分配 sequence 并保存 sourceSnapshot、DAG 与 sourceHash；`finishResearchExecution` 汇总 Cell 执行和环境指纹，写 success/error/cancelled 等终态。它们是运行层内部入口，不自行做用户归属检查。

同文件 `listResearchExecutions`、`getResearchExecution`、`promoteResearchExecution` 供 evidence 路由和 handoff 使用，按本人普通文档过滤。只有 success 可 promote；固化更新展示名、标签、备注和首次 promotedAt，不重跑或改源码。嵌入内部文档虽复用执行表，不能通过普通固化入口进入 [handoff](../handoff/README.md)。

[artifacts.ts](artifacts.ts) 的 `materializeResearchOutputArtifacts` 把运行输出转成可持久化内联块及图片记录，限制内联总量 2 MiB、单图 4 MiB，校验图片并产生哈希；由普通结果保存及 embedded/finish 在各自事务中落库。[fingerprints.ts](fingerprints.ts) 的 `researchPayloadHash` 提供稳定内容摘要，不代表数据库授权。

[read-artifact.ts](read-artifact.ts) 的 `readResearchArtifact(userId, artifactId)` 先按 document.userId 读取私有内容；evidence 路由随后处理 ETag、304 与安全响应头，不能提前使用缓存跳过归属检查。

改证据结构看 [execution-records.test.ts](execution-records.test.ts)、[fingerprints.test.ts](fingerprints.test.ts)；改图片和大小限制看 [artifacts.test.ts](artifacts.test.ts)；授权及缓存响应看 [路由集成测试](../routes/index.integration.test.ts)。

[返回 Research 总览](../README.md)
