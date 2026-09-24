# 研究整理与人工反馈

Curator 从已有研究证据生成待处理发现，拥有 CuratorRun 与 research-curator Job。它不修改研究源码或代替用户固化执行。

[submit.ts](submit.ts) 的 `submitResearchCuratorRun` 供 curator 路由调用，复用活动运行，从最近成功运行读取 cursor，在同一事务检查活动运行、读取 cursor 并创建 Run + queued Job，创建成功后唤醒。日志在执行开始时初始化。

[prepare.ts](prepare.ts) 的 `extractResearchCuratorEvidence` 和 `prepareResearchCuratorRun` 读取用户证据、调用模型并核验候选；[reference-search.ts](reference-search.ts) 读取仓库参考资料，仓库根按 API 工作目录解析。这些工作发生在完成事务外，prepare 返回候选，不发布 findings。

[research-curator-lifecycle.ts](research-curator-lifecycle.ts) 的 `researchCuratorLifecycle` 准备候选后通过 onSuccess 核对 runId/userId、在同一事务重查 fingerprint 并发布 findings 和统计。运行状态从 Job 投影；失败不发布部分候选，候选准备不进入数据库事务。

[read.ts](read.ts) 的 `getLatestResearchCuratorRun`、`getResearchCuratorRun`、`researchCuratorQuality` 查询本人运行／发现和质量统计；[feedback.ts](feedback.ts) 的 `setResearchCuratorFindingDisposition`、`updateResearchCuratorFindingFeedback` 保存人工处置及核验反馈。两者共用 [views.ts](views.ts) 纯映射，不依赖 LLM 准备层。

改提交复用、候选落库或反馈看 [runs.test.ts](runs.test.ts) 和 [路由集成测试](../routes/index.integration.test.ts)，改仓库查找看 [reference-search.test.ts](reference-search.test.ts)。Job 注册与恢复调用链见 [Jobs](../../jobs/README.md)。

[返回 Research 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：researchCuratorJobPayloadSchema / ResearchCuratorJobPayload；提交与读取共用严格的 runId 对象契约。
