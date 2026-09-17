# Research 数据切片与公开列映射

这里将已有市场数据转换成 Research SDK 的字段、时间序列和截面，不负责供应商同步。主要消费者为 [SDK dispatch](../sdk/README.md)，HTTP 的股票池查询和目录也使用其中的读取能力。

| 文件 / 关键入口 | 业务口径 |
| --- | --- |
| [series.ts](series.ts) `loadResearchSeries`、`prepareResearchSeries` | 读取既有资产／宏观序列，按请求准备频率和变换；加载窗口与最终展示窗口分开，避免收益变换丢首值 |
| [equity.ts](equity.ts) `loadResearchCrossSection`、`loadResearchPanel` | 股票截面／面板，明确日期、字段及股票池范围 |
| [universe.ts](universe.ts) `executeUniverseSpec`、`applyUniverseSpec`；[spec.ts](spec.ts) `parseUniverseSpec` | 前者查库取候选并筛选，apply 处理内存数据，parse 校验规格，不能互换副作用 |
| [financial.ts](financial.ts) `loadResearchFinancialStatements`、`loadResearchFinancialMetrics`、`loadResearchFinancialCrossSection`、`loadResearchFinancialPanel` | 财报明细、派生指标及面板，保留报告期／可得性规则 |
| [financial-values.ts](financial-values.ts) `loadResearchFinancialValues` | 使用财务版本和 normalized value，保留来源及空值语义 |
| [commodity.ts](commodity.ts) `loadResearchCommodityReturns`、`loadResearchCommodityWarehouseReceipts`、`loadResearchCommodityHoldings` | 商品收益、仓单、持仓研究列；不把连续收益当可成交合约 |
| [supplemental.ts](supplemental.ts) 的 loadResearchMarketState、loadResearchEquityFundamentals/Flows/Dividends | 市场状态、股票基本面／资金／分红切片 |
| [market-reference.ts](market-reference.ts) 的 loadResearchEtfShares、loadResearchIndexValuation、loadResearchIndustryState、loadResearchFuturesSettlement | ETF 份额、指数估值、行业和期货结算参考数据 |

[cross-market-data-contracts.ts](cross-market-data-contracts.ts) 维护 Research 的来源决策和数据契约投影，不替代 Market registry 的共享身份。PIT 选择、availableDate 与原始观测日不能互换，缺失值不应因文档示例变成补零。每类取数上限和有效字段以 sdk/validation 与对应 loader 为准。

本人报告的授权、体积和 snake_case 投影有独立 [results 说明](results/README.md)，不复用 HTTP wire 或报告生命周期服务。

改某数据列先读对应同名测试；跨市场约束看 [cross-market-data-contracts.test.ts](cross-market-data-contracts.test.ts)，股票池看 [universe.test.ts](universe.test.ts)，SDK 协议映射还需对照 [dispatch.test.ts](../sdk/dispatch.test.ts)。底层数据解释见 [Market](../../market/README.md)。

[返回 Research 总览](../README.md)
