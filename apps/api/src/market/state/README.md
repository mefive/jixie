# 市场状态、天气与风险输入

| 文件 / 入口 | 职责与使用方 |
| --- | --- |
| [sync.ts](sync.ts) `syncMarketIndicators(start, end)` | Maintenance／CLI；按自然年分片执行批量 SQL，构造市场／指数／行业派生指标；每片的临时表和替换在事务内 |
| [compute.ts](compute.ts) `buildMarketStateSnapshot`、`buildMarketStatePoints`、`buildIndustryWeatherSeries`、`buildIndexWeatherSeries` | 纯计算输入行 → 视图，不查询数据库 |
| [read.ts](read.ts) `loadMarketState` | state 路由；按 scope 取已发布数据并构造当前状态，缺失返回 null |
| [weather.ts](weather.ts) `loadMarketWeather`、`loadIndustryWeatherSeries` | weather 路由及其行业分派；按维度和频率装配序列、复用进程内缓存 |
| [market-risk-drivers.ts](market-risk-drivers.ts) `loadMarketRiskDriverHistory`、`buildMarketRiskDriverHistory` | Strategy 风险与审计输入；前者查库，后者用已有输入构造风险轴收益 |
| [market-risk-driver-quality.ts](market-risk-driver-quality.ts) `inspectMarketRiskDrivers`、`summarizeMarketRiskDriverQuality` | 基础覆盖／异常审计，分别为读取入口与摘要计算 |

天气缓存以维度、频率及相关数据覆盖日期为键；保持现有失效方式，不能宣称每次请求重新计算或内容哈希失效。行业通过统一 weather 入口继续使用独立行业计算。官方估值和成分派生估值按实现合并，缺失与覆盖率仍需保留。

基础数据质量归这里，模型拟合历史长度／准入门槛归 [Strategy risk](../../strategy/risk/README.md)，整个维护批次水位归 Maintenance。状态读取不负责 Factor 天气的 Job 生命周期。

改指标计算看 [compute.test.ts](compute.test.ts)，改风险输入看 [market-risk-drivers.test.ts](market-risk-drivers.test.ts)；HTTP 和缓存调用看 [routes/index.test.ts](../routes/index.test.ts)，模型审计还需对照 [Strategy 数据就绪](../../strategy/risk/data-readiness.ts)。

[返回 Market 总览](../README.md)
