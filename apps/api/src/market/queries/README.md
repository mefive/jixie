# 跨资产图表序列查询

[instrument-series.ts](instrument-series.ts) 的 `instrumentSeries(assetType, tsCode, start?, end?)` 由 [Market instrument 路由](../routes/instrument.ts) 消费，读取已有数据库，返回 StockSeries 形状的统一对象；不请求供应商、不进行用户授权，也不补同步。身份和参数由调用方校验。

股票拼接行情、PE 与复权，ETF 拼接行情和复权；缺失附属字段保留 null。指数只有 close 时用该值填充 OHLC，vol/adjFactor 为 null，这不是供应商提供了完整指数 K 线。

期货先查连续代码在日期内的逐日映射；有映射时只取该日对应实际合约的行情，缺行情则省略该点；无映射时按输入实际合约读取。它不计算收益连续化或换月调整，商品收益研究应看 [commodity](../commodity/README.md)。未知名称回退代码，空序列不伪造数据。

精简指数 HTTP `{date, close}` 仍由 [indices/read](../indices/README.md) 提供，不能因功能相近而改它的响应契约。改统一映射和日期语义看 [Market 路由测试](../routes/index.test.ts)，修改原始数据生产则去对应资产能力。

[返回 Market 总览](../README.md)
