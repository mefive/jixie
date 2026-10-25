# 因子分析与报告

本目录校验分析输入、保存提交时的代码与参数、创建后台任务并读取结果。

| 入口 | 调用与职责 |
| --- | --- |
| [submit.ts](submit.ts) `submitFactorAnalysis` | HTTP analysis 路由；解析来源、校验日期和数据截止日 |
| [start.ts](start.ts) `startFactorAnalysis` | HTTP 与 Agent；在事务内创建报告和 queued Job，复用相同活动任务 |
| [read.ts](read.ts) `listFactorReports`、`readFactorReport`、`readFactorAnalysisJob` | 校验用户归属后读取报告、结果和日志 |
| [job-lifecycle.ts](job-lifecycle.ts) `factorAnalysisLifecycle` | 注册 factor-analysis，计算并保存结果和失败状态 |

`variantKey` 来自代码、参数与数据版本，只用于匹配仍在排队或运行的分析。已完成后重复提交会创建新报告。用户自行选择日期，所有已完成报告与日志均可由本人直接读取。

[report-spec.ts](report-spec.ts) 保留存储列映射与旧 spec 回退；[report-views.ts](report-views.ts) 提供报告摘要；[identity.ts](identity.ts) 维护活动分析身份。[job-payload.ts](job-payload.ts) 校验提交时固定的执行输入，Worker 输入归 analysis/worker-input.ts。

[publication](../publication/README.md) 检查当前代码与成功报告匹配后发布不可变因子版本。分析计算仍保留 PIT、成本、样本和统计方法；发布没有盈利或显著性门槛。

旧研究卡、探索／保留段划分、提交／揭示和尝试统计已退役。相关 API 返回 404。历史报告的代码、参数、结果和发布关联保留，原未揭示结果按普通报告读取。

验证入口：[start.test.ts](start.test.ts)、[read.test.ts](read.test.ts)、[identity.test.ts](identity.test.ts)、[HTTP 边界](../routes/index.integration.test.ts)、[隔离迁移](../../../tests/factor-research-gates-migration.test.ts)。
