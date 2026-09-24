# 正式评估、报告与 holdout

本目录拥有 FactorReport 与正式评估 Job 的冻结、读取和状态；实际数值计算委托 [execution](../execution/README.md)。相关性缓存和天气观察有各自生命周期，不在这里创建报告。

## 消费入口

| 文件 / 入口 | 主要调用方与契约 |
| --- | --- |
| [submit.ts](submit.ts) `submitFactorAnalysis` | analysis 路由；接收用户、已保存来源标识、spec、researchIntent，检查方法／来源／截止日及父报告，返回任务与报告标识 |
| [start.ts](start.ts) `startFactorAnalysis` | submit 及两个 Agent 正式分析工具；接收已解析或候选源码、研究配置与日志文案，冻结并创建／复用报告和 Job。它不替代各调用方的前置准入 |
| [holdout.ts](holdout.ts) `submitFactorHoldout`、`revealFactorHoldout` | analysis 路由；从父报告证据申请 holdout，或显式揭示本人已完成报告 |
| [read.ts](read.ts) `listFactorReports`、`readFactorReport`、`readFactorAnalysisJob` | analysis 路由；按拥有者读取，分别执行报告投影与 holdout 日志封存 |
| 同文件 `readFactorAnalysisResult` | Agent 分析工具轮询 explore 结果；不作为通用报告详情入口 |
| 同文件 `readFactorResearchWindow`、`readFactorResearchSummary` | 研究窗口和尝试统计查询 |
| [factor-analysis-lifecycle.ts](factor-analysis-lifecycle.ts) `factorAnalysisLifecycle` | 在 jobs/register 注册为 factor-analysis；onExecute 计算，onSuccess 保存业务结果 |

## 冻结、计算和封存

普通提交先计算源码快照／语言哈希、variantKey 与 testKey，再在事务内复查活动报告；可复用则返回原 ID，否则创建 Report + queued Job。提交后唤醒队列，日志在执行开始时初始化。holdout 使用独立的资格检查、父快照和创建事务，不合并成普通提交的别名。

Job 校验 payload 与持久化报告关联，启动共享 Worker；Worker 返回结果且正常退出后，通过 onSuccess 同事务更新报告与 Job 终态。Worker 失败保留本地化 failureMessage；报告状态从 Job 投影，启动恢复只将中断 Job 置 stale；计算、编译和外部调用不放入完成事务。

[report-spec.ts](report-spec.ts) 的 `reportCompatibilityColumns` / `reportResearchSpec` 维护存储列映射和旧 spec 回退；[report-views.ts](report-views.ts) 负责投影和封存。[identity.ts](identity.ts) 维护评估身份；[research-policy.ts](research-policy.ts)、[holdout-policy.ts](holdout-policy.ts) 维护窗口、统计和资格。

未揭示 holdout 在列表、详情、Job 日志三处保密。`readOwnedFactorJob` 只核对所有权和 kind，不能代替 `readFactorAnalysisJob`；相关性任务入口也不能取得分析报告日志。发布读取证据时仍核对当前源码，旧结果不自动证明新代码。

## 修改定位

冻结／复用看 [start.test.ts](start.test.ts)、[identity.test.ts](identity.test.ts)；统计看 [research-policy.test.ts](research-policy.test.ts)；查询看 [read.test.ts](read.test.ts)。holdout 权限、封存与事务看 [路由集成测试](../routes/index.integration.test.ts)，生命周期看 [Job 集成测试](../../../tests/job-lifecycle.integration.test.ts)。

[报告历史设计](../../../../../docs/design/factor-report-history.md) 保存背景；[服务边界记录](../../../../../docs/design/core-business-service-boundaries.md#6-单独记录不混入本次重构) 保存 Agent 候选语言传递的既有范围外问题，不把预期修复写成现有行为。

[返回 Factor 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：factorAnalysisJobPayloadSchema / FactorAnalysisJobPayload；普通提交和 holdout 共用类型，读取时保留已有 spec 规范化规则。Worker 公共输入归 execution/worker-input.ts。
