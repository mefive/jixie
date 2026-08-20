# 在策略中使用技术指标

回测 SDK 可以按当前交易日以前的后复权 K 线现场计算 ADX／DMI、Bollinger Bands、RSI、MACD 和 KDJ。它们是对历史价格和成交行为的变换，不是未来收益信号；使用前要写清周期、阈值和交易规则。

## 五类指标返回什么

- ADX／DMI：`adx` 表示趋势强度，`positiveDi`／`negativeDi` 表示方向分量；默认 14 个周期。
- Bollinger Bands：返回中轨 `middle`、上轨 `upper`、下轨 `lower`；默认 20 个周期和 2 倍总体标准差。
- RSI：返回 0～100；默认 14 个周期，完全平盘窗口返回 50。
- MACD：返回 `line`、`signal`、`histogram`；默认 12／26／9，柱值等于线减信号，不乘 2。
- KDJ：返回 `k`、`d`、`j`；默认 9／3／3，K 和 D 的初值为 50。

## 在日线策略中调用

下面两段代码读取相同的默认周期，并先处理历史不足。

:::code-tabs
```typescript
const directional = ctx.adx(code, 14);
const bands = ctx.bollingerBands(code, 20, 2);
const strength = ctx.rsi(code, 14);
const convergence = ctx.macd(code, 12, 26, 9);
const stochastic = ctx.kdj(code, 9, 3, 3);

if (!directional || !bands || strength == null || !convergence || !stochastic) {
  return;
}
```
```python
directional = ctx.adx(code, 14)
bands = ctx.bollinger_bands(code, 20, 2)
strength = ctx.rsi(code, 14)
convergence = ctx.macd(code, 12, 26, 9)
stochastic = ctx.kdj(code, 9, 3, 3)

if any(value is None for value in [directional, bands, strength, convergence, stochastic]):
    return
```
:::

Python 使用 `positive_di`、`negative_di` 和 `bollinger_bands`；TypeScript 使用 `positiveDi`、`negativeDi` 和 `bollingerBands`。两种语言的数学口径和回测交易规则一致。

## 把指标变成规则

不要只写“使用 MACD”。必须规定什么时候持有、空仓或调整仓位。例如：

1. ADX 不低于 20，且正向 DMI 高于负向 DMI；
2. 收盘价在 Bollinger 中轨之上；
3. RSI 不低于 50；
4. MACD 线高于信号线；
5. K 高于 D；
6. 五项中至少四项成立时目标仓位 60%，三项成立时 30%，否则 0。

这只是可复现规则示例，不代表最佳阈值。阈值过多、在同一历史区间反复调整，会增加过拟合风险。

![包含技术指标策略的真实回测结果](/docs/images/help/zh/backtesting/technical-indicators-01.png)

## 周线和月线

TypeScript 可以通过 `ctx.weekly(code)` 或 `ctx.monthly(code)` 获得周期视图，再调用同名指标。周线和月线只使用已经完成的周期，当前尚未结束的周或月不会提前作为完整 K 线参与计算。

日线的“14”是 14 个交易日，周线是 14 个已完成交易周，月线是 14 个已完成交易月，不能混为相同时间长度。

## 历史不足和判空

递归指标需要预热历史，实际所需数据可能多于表面周期。历史不足、参数无效或当前没有可用价格时会返回 `null`／`None`。必须先判空，再读取内部字段或下单。不要用 0 填补未形成的指标。

## 验证步骤

1. 用固定参数先运行一段包含足够预热期的区间。
2. 在日志输出少量日期的指标值和最终规则分数。
3. 核对第一笔交易没有早于指标形成日期。
4. 查看交易明细、换手和成本，不只看收益率。
5. 改变周期或阈值后重新运行并保存新结果。

## 相关内容

- [使用 Python 编写策略](/docs/help/backtesting/python-strategy)
- [多周期策略](/docs/help/backtesting/multi-timeframe)
- [运行回测并查看日志](/docs/help/backtesting/run-and-logs)

