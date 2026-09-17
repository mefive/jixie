# 指数估值展示

[read.ts](read.ts) 的 `loadIndexValuationCatalog` 供 valuation 路由读取有实际覆盖的预设指数及起止日期／行数；`loadIndexValuation(tsCode)` 只接受 registry 的官方估值指数，读取 indexDailyBasic 和收盘序列，无支持或无有效数据返回 null，由路由映射响应。

[compute.ts](compute.ts) 的 `buildIndexValuationSeries` 接收已加载的估值和价格行，生成展示序列，不查询数据库或触发同步。日期对齐、有效 PE/PB 和历史统计窗口必须以它的实现为准，不能由 UI 或 README 另定一套补值规则。

原始官方估值生产在 [indices](../indices/README.md)，天气中成分派生指标在 [state](../state/README.md)；这里不创建估值报告或 Job。改序列看 [compute.test.ts](compute.test.ts)，改支持范围／空值 HTTP 看 [routes/index.test.ts](../routes/index.test.ts)。

[返回 Market 总览](../README.md)
