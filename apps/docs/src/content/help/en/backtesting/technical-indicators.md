# Use technical indicators in a strategy

The backtest SDK calculates ADX/DMI, Bollinger Bands, RSI, MACD, and KDJ from adjusted bars available through the current trading date. They transform historical price and trading behavior; they are not forecasts. Prespecify periods, thresholds, and trading rules.

## What the five indicators return

- ADX/DMI: `adx` measures trend strength; `positiveDi` and `negativeDi` are directional components. Default: 14 periods.
- Bollinger Bands: `middle`, `upper`, and `lower`. Default: 20 periods and two population standard deviations.
- RSI: a value from 0 through 100. Default: 14 periods; a fully flat window returns 50.
- MACD: `line`, `signal`, and `histogram`. Default: 12/26/9; histogram is line minus signal and is not doubled.
- KDJ: `k`, `d`, and `j`. Default: 9/3/3, with K and D seeded at 50.

## Call daily indicators

Both examples use the same default periods and handle insufficient history first.

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

Python uses `positive_di`, `negative_di`, and `bollinger_bands`; TypeScript uses `positiveDi`, `negativeDi`, and `bollingerBands`. Their mathematical definitions and backtest trading rules are aligned.

## Turn indicators into a rule

“Use MACD” is not a trading rule. Define when to hold, exit, or resize. For example:

1. ADX is at least 20 and positive DMI exceeds negative DMI;
2. close is above the Bollinger middle band;
3. RSI is at least 50;
4. MACD line exceeds its signal;
5. K exceeds D;
6. target 60% when at least four conditions hold, 30% when three hold, and zero otherwise.

This is a reproducible example, not an optimal threshold set. Repeatedly tuning many thresholds on the same history increases overfitting risk.

![A completed backtest using technical indicators](/docs/images/help/zh/backtesting/technical-indicators-01.png)

## Weekly and monthly periods

TypeScript can call the same indicators from `ctx.weekly(code)` or `ctx.monthly(code)`. Weekly and monthly views use completed periods only; an unfinished current week or month is not treated as a complete bar.

Fourteen daily periods means 14 trading days, while 14 weekly or monthly periods mean 14 completed trading weeks or months. They are not equivalent horizons.

## Warm-up and null handling

Recursive indicators need warm-up data and can require more history than the displayed period. Insufficient history, invalid parameters, or unavailable prices return `null` or `None`. Check before reading fields or placing an order. Do not fill an unformed indicator with zero.

## Validation steps

1. Start with fixed parameters and a range containing enough warm-up history.
2. Log indicator values and the final rule score for a small number of dates.
3. Verify that the first trade does not precede indicator availability.
4. Inspect trades, turnover, and costs, not only return.
5. Rerun and save a new result after changing a period or threshold.

## Related articles

- [Write a strategy in Python](/docs/help/backtesting/python-strategy)
- [Multi-timeframe strategies](/docs/help/backtesting/multi-timeframe)
- [Run a backtest and inspect logs](/docs/help/backtesting/run-and-logs)

