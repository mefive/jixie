# 回测月度宏观分析

完整回测通过 [backtest-risk-analysis.ts](backtest-risk-analysis.ts) 的 `attachBacktestRiskAnalysis` 附加月度宏观敏感度，保存在 `result.allocationAnalysis.risk.macro`。没有独立 HTTP API、Job 或报告。

数据来自 [Market macro](../../market/macro/README.md)，拟合与月度收益聚合仍由 [macro-risk-model.ts](macro-risk-model.ts) 完成。现金账户 scope 必须使用对应 NAV，不回退其他净值。五轴定义、回归公式、Newey–West 和 PIT／latest-vintage 披露保持原口径，数据不足不补零。

依赖期货连续收益的日频市场风险、Alpha 重合与压力情景整体退役；不重新拼接替代来源，也不把其收益混入月度模型。旧报告内容原样保留。

[data-readiness.ts](data-readiness.ts) 的宏观准入仍供 [Maintenance 审计](../../maintenance/publication/risk-audit.ts) 使用。正式回测捕获附加分析异常并记录日志，主回测仍可成功；参数扫描不调用此后处理。

回归入口：[backtest-risk-analysis.test.ts](backtest-risk-analysis.test.ts)、[macro-risk-model.test.ts](macro-risk-model.test.ts)、[risk-research-contract.test.ts](risk-research-contract.test.ts)。
