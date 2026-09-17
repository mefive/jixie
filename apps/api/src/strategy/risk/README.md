# 回测风险研究与模型就绪要求

风险研究是完整回测结果的附加分析，写入 `result.allocationAnalysis.risk`，没有独立 HTTP API、Job 或报告。数据事实来自 [Market state](../../market/state/README.md) 和 [macro](../../market/macro/README.md)。

| 文件 / 入口 | 职责与主要调用方 |
| --- | --- |
| [backtest-risk-analysis.ts](backtest-risk-analysis.ts) `attachBacktestRiskAnalysis`、`buildBacktestRiskAnalysis` | backtests/run 的后处理入口；attach 加载数据并修改计算结果，build 装配分析内容 |
| [market-risk-model.ts](market-risk-model.ts) `estimatePortfolioMarketRisk` | 市场暴露估计和收益对齐 |
| [macro-risk-model.ts](macro-risk-model.ts) `estimatePortfolioMacroRisk` | 月频宏观敏感度，区分 strict PIT 与 exploratory 历史 |
| [alpha-risk-overlap.ts](alpha-risk-overlap.ts) `analyzeAlphaRiskOverlap` | 因子 Alpha 与风险轴重合分析，保留日期及可得性对齐 |
| [risk-scenarios.ts](risk-scenarios.ts) `evaluateDeterministicRiskScenarios`、`evaluateHistoricalRiskScenarios` | 确定性与历史压力情景 |
| [data-readiness.ts](data-readiness.ts) `marketRiskDataReadiness`、`macroRiskDataReadiness`、`selectMacroRiskAuditStart` | Maintenance 风险审计消费基础质量摘要，输出模型层错误／警告及取数窗口 |

市场审计要求完整 252 条历史窗口，模型最小拟合样本为另一门槛；宏观准入检查 36 条完整 exploratory 观察，strict PIT 不足保留警告语义。不要把拟合下限、审计完整窗口和可展示条件互换。缺失输入不补零，结果保留数据日期与血缘。

正式回测捕获风险后处理异常并记录日志，主回测仍可成功；扫描及 Signals 不调用这一完整后处理。组合持仓、成本和交易循环累计仍归 Engine。

修改分析先读各同名测试：[backtest-risk-analysis.test.ts](backtest-risk-analysis.test.ts)、[market-risk-model.test.ts](market-risk-model.test.ts)、[macro-risk-model.test.ts](macro-risk-model.test.ts)、[alpha-risk-overlap.test.ts](alpha-risk-overlap.test.ts)、[risk-scenarios.test.ts](risk-scenarios.test.ts)。模型／数据边界看 [risk-research-contract.test.ts](risk-research-contract.test.ts) 和 [Maintenance 风险审计实现](../../application-maintenance/risk-data-audit.ts)。

[返回 Strategy 总览](../README.md)
