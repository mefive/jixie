# 风险输入与商品发布状态

| 文件 / 入口 | 职责与使用方 |
| --- | --- |
| [market-risk-drivers.ts](market-risk-drivers.ts) `loadMarketRiskDriverHistory`、`buildMarketRiskDriverHistory` | Strategy 风险与审计输入；前者查库，后者用已有输入构造风险轴收益 |
| [market-risk-driver-quality.ts](market-risk-driver-quality.ts) `inspectMarketRiskDrivers`、`summarizeMarketRiskDriverQuality` | 基础覆盖／异常审计，分别为读取入口与摘要计算 |
| [current.ts](current.ts) `currentCommodityRows` | Research 商品连续收益读取，仅返回独立合格产品 |

市场天气、市场／指数／行业派生状态及其缓存和维护计算已退役。风险输入的原始来源仍由本域读取；模型拟合历史长度与准入门槛归 [Strategy risk](../../strategy/risk/README.md)。本目录不再生成天气指标。

[返回 Market 总览](../README.md)
