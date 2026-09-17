# 指数、行业与精简收盘读取

[sync.ts](sync.ts) 的入口供日／周维护和对应 CLI 调用：`syncIndexWeight` 同步权重，`syncIndexBenchmarks` 同步指数元数据，`syncIndexDaily`／`syncIndexDailyBasic` 同步行情和官方估值，`syncSwIndustry`／`syncSwIndexDaily` 同步申万成员与行业指数日行情。各入口拥有自己的请求范围和替换事务，不构成一次全域发布。

代码集合和天气分组来自 [registry/index-presets.ts](../registry/index-presets.ts)，供应商字段来自 providers/tushare/api。申万成员包含生效／退出日期，消费者按时点选择；不能只用当前成员回填历史分析。Market state 使用这些原始输入生成派生指标，估值展示由 [valuation](../valuation/README.md) 负责。

[read.ts](read.ts) 的 `loadIndexSeries(tsCode, start, end)` 供 instrument 路由的 `/indices/:indexCode/series` 使用，只返回 `{ points: [{ date, close }] }`。默认区间在路由确定，无数据仍是空数组；不要与 [instrumentSeries](../queries/README.md) 的完整对象响应合并。

改官方估值适配看 [index-daily-basic-api.test.ts](../providers/tushare/index-daily-basic-api.test.ts)，索引清单看 [index-presets.test.ts](../registry/index-presets.test.ts)，精简响应看 [routes/index.test.ts](../routes/index.test.ts)。

[返回 Market 总览](../README.md)
