# 财报来源、版本选择与财务指标

本能力维护底层财务事实、来源和可得性；Research 负责 SDK 公开列映射，FCFF 模板负责研究假设。报表版本不等于最新财务指标快照，不能用后者替代时点证据。

| 文件 / 入口 | 调用方及输入输出 |
| --- | --- |
| [source-contract.ts](source-contract.ts) `normalizeFinancialStatementSourceRow`、`resolveFinancialAvailability`、`appendFinancialStatementSourceRows` | 同步和测试消费的纯规则；规范来源、证据可得性、合并内存版本数组，不写数据库 |
| [sync.ts](sync.ts) `syncFinancialStatementsVip`、`syncFinancialStatementsByStock` | Maintenance 参考数据子进程；分报告期或有界公告日期窗口拉三表，显式请求报告类型，追加新版本并回调完成进度 |
| 同文件 `storeFinancialCorrectionEvidence` | 维护来源证据；写更正公告并只给无歧义匹配版本附精确证据，不能把模糊更正日期当确切公告 |
| [resolver.ts](resolver.ts) `resolveFinancialState`、`resolveFinancialStates`、`selectLatestStatementVersions` | Research／审计；前两者按 asOfDate 查库和规范代码，后者选择版本，保留报告类型、来源和可得性 |
| [normalize.ts](normalize.ts) `normalizeIncomeFlows`、`normalizeCashFlows` | 累计流量转单季／TTM，缺少必要期数保留缺失而非补零 |
| [metrics.ts](metrics.ts) `calculateFinancialMetrics` | 输入 ResolvedFinancialState，按版本化公式生成指标及来源，不查询市场 |
| [reference-sync.ts](reference-sync.ts) `syncFinaIndicator`、`syncFinaIndicatorVip`、`syncDividend` | 参考指标和分红增量协调，独立于三表 append-only 版本同步 |
| [reference-periods.ts](reference-periods.ts) `financialHistoryStart`、`quarterlyReportPeriods` | weekly／历史导入共用的纯时间范围计算 |

resolver 以 availableDate ≤ asOfDate 读取支持的工业合并报表，并按当时行业／市值构造状态；市值从供应商万元转换为元。批量入口允许调用方提供 market snapshots，报告窗口也有独立边界。版本哈希、公告日期和更正证据不能因为相同 endDate 合并丢失。

三表同步按批次保存，完成回调在对应范围处理后；没有覆盖网络、所有报表及整轮维护的总事务。[accounting-quality.ts](accounting-quality.ts) 的 `inspectFinancialAccounting` 与 [valuation-sample-audit.ts](valuation-sample-audit.ts) 的 `auditValuationState` 检查财务／估值样本，不同步数据。

改来源与版本先读 [source-contract.test.ts](source-contract.test.ts)、[sync.test.ts](sync.test.ts)、[resolver.test.ts](resolver.test.ts)；公式看 [normalize.test.ts](normalize.test.ts)、[metrics.test.ts](metrics.test.ts)，参考同步看 [reference-sync.test.ts](reference-sync.test.ts)。`fixtures/financial-source-versions.json` 是这些规则的测试样本，由本能力覆盖，不是生产 seed 或独立能力。

[返回 Market 总览](../README.md)
