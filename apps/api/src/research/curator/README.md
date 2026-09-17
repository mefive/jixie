# 研究整理与人工反馈

Curator 从已有研究证据生成待处理发现，拥有 CuratorRun 与 research-curator Job。它不修改研究源码或代替用户固化执行。

[submit.ts](submit.ts) 的 `submitResearchCuratorRun` 供 curator 路由调用，复用活动运行，从最近成功运行读取 cursor，同一事务创建 Run + queued Job，提交后初始化日志并唤醒。活动查询与创建之间保留现有并发窗口，不能承诺跨请求串行。

[prepare.ts](prepare.ts) 的 `extractResearchCuratorEvidence` 和 `prepareResearchCuratorRun` 读取用户证据、调用模型并核验候选；[reference-search.ts](reference-search.ts) 读取仓库参考资料，仓库根按 API 工作目录解析。这些工作发生在完成事务外，prepare 返回候选，不发布 findings。

[job.ts](job.ts) 的 `researchCuratorJob` 在 complete 核对输出的 runId/userId，使用执行器 transaction 对已存在及同批候选查重、发布 findings，并按本人 running Run 条件更新数量／状态；Job 终态由同一执行器事务收尾。fail/recover 处理错误及服务重启状态，不将候选生成包进数据库事务。

[read.ts](read.ts) 的 `getLatestResearchCuratorRun`、`getResearchCuratorRun`、`researchCuratorQuality` 查询本人运行／发现和质量统计；[feedback.ts](feedback.ts) 的 `setResearchCuratorFindingDisposition`、`updateResearchCuratorFindingFeedback` 保存人工处置及核验反馈。两者共用 [views.ts](views.ts) 纯映射，不依赖 LLM 准备层。

改提交复用、候选落库或反馈看 [runs.test.ts](runs.test.ts) 和 [路由集成测试](../routes/index.integration.test.ts)，改仓库查找看 [reference-search.test.ts](reference-search.test.ts)。Job 注册与恢复调用链见 [Jobs](../../infra/jobs/README.md)。

[返回 Research 总览](../README.md)
