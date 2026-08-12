# 多周期 K 线设计

## 目标

日频回测继续只运行一条逐交易日主循环，同时让策略直接组合“已完成周线/月线过滤 + 当日日线进场”。
SDK 提供：

```ts
const weekly = ctx.weekly(code);
const monthly = ctx.monthly(code);

weekly.bars(20);
weekly.history('close', 20);
weekly.sma(10);
weekly.ema(10);
weekly.atr(14);
weekly.highest('high', 20);
weekly.lowest('low', 20);
weekly.avgAmount(20);
weekly.avgVol(20);
weekly.adx(14);
weekly.bollingerBands(20, 2);
weekly.rsi(14);
weekly.macd(12, 26, 9);
weekly.kdj(9, 3, 3);
```

这些接口与日线一样要求个股 K 线已经加载：静态标的放进 `watch`，动态选股先调用
`await ctx.ensureBars(codes)`。扩充指标的公式、默认值与有限预热窗口见
`docs/design/technical-indicators.md`。

## 聚合语义

- 周线按 ISO 周（周一到周日）分桶，月线按自然月分桶。
- `date` 是该标的在周期内最后一根实际日 K 的日期；停牌不会虚构日 K。
- `open` 取首根、`high` 取最高、`low` 取最低、`close` 取末根。
- `vol`、`amount` 对非空日值求和；全周期都为空时保持 `null`。
- `turnoverRateF` 对周期内已有日值求均值，供内部研究窗口使用。
- 所有返回窗口均从旧到新；数据不足时指标返回 `null`。

## 防未来函数

聚合缓存可以预先生成所有候选桶，但每次读取仍按当前交易日切片。当前周/月只有在交易所下一开市日
已经跨入新周/月时才可见。因此：

- 周三看不到本周尚未收盘的周 K；
- 周五收盘后，如果下一开市日是下周，本周 K 当天可见；
- 月末最后交易日收盘后，当月 K 当天可见；
- 标的在最后交易日停牌时，周期仍按市场交易日历正常收盘，K 线日期保留为该标的最后实际成交日。

为判断回测末日是否恰好是周期末，引擎只额外读取末日后 40 个日历日范围内的交易日历；行情读取仍
严格限制在回测 `[start, end]`，不会加载未来价格。如果交易日历没有下一开市日，则保守地把当前周期
视为未完成。

## 缓存与执行一致性

每个 `EngineData` 实例按 `code + timeframe` 缓存一次聚合结果，随后只做时点切片。direct 与
isolated-vm 都打包并调用同一份数据层和 SDK 实现；fixture 漂移测试会用周线指标实际触发订单，逐项比较
两条执行车道的成交与净值。
