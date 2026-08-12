# 策略技术指标扩充

> 2026-08-12 完成，对应 `ROADMAP.md` 2.3。指标读取回测内存中的后复权 K 线现场计算，不入库。

## 范围与 API

TypeScript 日线及已完成周线/月线统一支持：

| 指标 | TypeScript | 默认参数 | 返回值 |
|---|---|---|---|
| ADX / DMI | `ctx.adx(code, period)` / `series.adx(period)` | 14 | `{ adx, positiveDi, negativeDi }` |
| 布林带 | `ctx.bollingerBands(code, period, standardDeviations)` / `series.bollingerBands(...)` | 20 / 2 | `{ middle, upper, lower }` |
| RSI | `ctx.rsi(code, period)` / `series.rsi(period)` | 14 | `0..100` |
| MACD | `ctx.macd(code, fastPeriod, slowPeriod, signalPeriod)` / `series.macd(...)` | 12 / 26 / 9 | `{ line, signal, histogram }` |
| KDJ | `ctx.kdj(code, period, kSmoothing, dSmoothing)` / `series.kdj(...)` | 9 / 3 / 3 | `{ k, d, j }` |

日线方法在 `ctx` 上接收 `code`；`ctx.weekly(code)` / `ctx.monthly(code)` 返回的周期句柄不再重复
接收 `code`。Python `py-v1` 当前只开放日线，方法与复合字段使用 snake_case：
`bollinger_bands`、`positive_di`、`negative_di`、`fast_period` 等。

SuperTrend 和 Parabolic SAR 本轮不做。它们是带明显初始化和状态约定的复合轨道，不是当前策略表达
必须的基础原语；有真实策略需求时再决定返回轨道、方向和反转事件的契约。

## 公式约定

- 输入统一为截至当前 bar 可见的后复权 OHLC；周/月指标只读取已经完整收盘的周期。
- ADX/DMI 使用 Wilder directional movement 与 Wilder 平滑；至少需要 `2 × period` 根 K 线。
- 布林带中轨为收盘 SMA，带宽使用最近 `period` 个收盘价的总体标准差，不使用样本标准差。
- RSI 使用 Wilder 平滑，至少需要 `period + 1` 个收盘价；全程平盘返回中性值 50。
- MACD EMA 以首个完整窗口 SMA 起算；`histogram = line - signal`，不采用国内部分软件的乘二口径。
- KDJ 的 RSV 使用最近 `period` 根高低区间，K/D 从 50 起算；零区间延续前一 K 值。
- 周期不是正整数、MACD 快线周期不小于慢线周期、标准差倍数为负或历史不足时返回 `null` / `None`。

## 历史窗口与计算位置

布林带只读取精确的 `period` 窗口。递归指标使用固定的有限预热窗口，避免每个 bar 从回测首日开始
重算全部历史：ADX、KDJ 最多读取 `4 × period` 根，RSI 最多读取 `4 × period + 1` 个收盘价，MACD
最多读取 `4 × slowPeriod + signalPeriod - 1` 个收盘价。

当前引擎仍只加载用户所选回测区间内的价格，因此区间开头在最小历史满足前返回空值；本轮不隐式
向前扩展回测数据范围。若以后增加显式 `warmupBars`，它属于所有窗口指标共同的回测输入契约，应进入
冻结配置和报告身份，而不是作为某个新指标的隐藏行为。

技术指标结果不持久化。底层 K 线在单次回测中按标的缓存，指标调用从内存窗口现场计算；这允许任意
参数扫描而不会产生“标的 × 日期 × 指标 × 参数”的派生表组合。

## 指数边界

`ctx.index(indexCode)` 保持独立 handle。指数代码虽然与股票/ETF 代码全局不重复，但指数行情来自独立
表、不可下单，并具有 `pe` / `pb` / `percentile` 等指数专属能力；普通 `ctx.sma(code)` 等接口则要求
加载可交易股票/ETF K 线。代码唯一不能消除数据来源和可交易能力的差异。

本轮没有把五项指标扩到 `IndexHandle`。以后若真实指数择时策略需要，应在该 handle 上增加明确支持的
价格指标，而不是让普通标的 API 按代码格式隐式分派资产类型。

## 验收护栏

- 纯函数 fixture 覆盖上涨、平盘、历史不足和非法参数；
- TypeScript 日线与已完成周/月句柄使用同一内核；
- Python 与 TypeScript 在同一行情上逐项数值一致；
- SDK 注册表与运行时成员双向类型检查，防止声明、文档、Agent 提示和实现漂移；
- isolated-vm 产品车道继续打包同一 TypeScript SDK，不增加第二套撮合或行情实现；
- 浏览器 E2E 用五项指标共同给 600519.SH 做趋势评分，从 Lab 点击启动真实 2024 全年回测，断言
  结果持久化且产生交易，并截图保留策略源码、评分日志和结果指标。
