# 跨资产图表序列查询

[instrument-series.ts](instrument-series.ts) 的 `instrumentSeries(assetType, tsCode, start?, end?)` 由 [Market instrument 路由](../routes/instrument.ts) 消费，读取已有数据库，返回 StockSeries 形状的统一对象；不请求供应商、不进行用户授权，也不补同步。身份和参数由调用方校验。

股票拼接行情、PE 与复权，ETF 拼接行情和复权；缺失附属字段保留 null。指数只有 close 时用该值填充 OHLC，vol/adjFactor 为 null，这不是供应商提供了完整指数 K 线。

仅保留股票、ETF 和普通指数对象；期货类型在入口拒绝，不改用其他资产行情。未知名称回退代码，空序列不伪造数据。

精简指数 HTTP `{date, close}` 仍由 [indices/read](../indices/README.md) 提供，不能因功能相近而改它的响应契约。改统一映射和日期语义看 [Market 路由测试](../routes/index.test.ts)，修改原始数据生产则去对应资产能力。

[返回 Market 总览](../README.md)
