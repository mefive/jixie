# Use weekly and monthly conditions

A strategy can combine completed weekly or monthly bars with current daily data. For example, it can use a monthly trend filter and a daily entry rule. Weekly and monthly series include completed periods only, preventing an unfinished week or month from appearing as known data.

## Describe the rule to the Agent

State which timeframe controls each rule:

> Use the CSI 300 ETF. Allow a position only when the last completed natural month's close is above its 10-month moving average. Entries still execute at the next trading-day open. Do not read the unfinished current month.

Or:

> Calculate trend from the latest 20 completed ISO weeks, then enter on a daily breakout above the latest 20-day high. Explain which data belongs to the weekly filter and daily trigger.

After generation, check for `ctx.weekly(code)` or `ctx.monthly(code)` and confirm that the daily order was not accidentally restricted to week-end or month-end only.

## Completed-period meaning

- **Weekly** bars use ISO weeks from Monday through Sunday and appear only after the last trading day of that week closes.
- **Monthly** bars use natural calendar months and appear only after the month's last trading day closes.
- A holiday-shortened period becomes available after its actual last trading day.
- A partial current week or month is never exposed early.

This prevents look-ahead data. On Wednesday, Thursday and Friday prices do not yet exist, so the strategy cannot know the current week's final close.

## Available data and indicators

Both timeframes provide:

- Open, high, low, and close.
- Volume and turnover.
- Simple and exponential moving averages.
- ATR.
- Window highest and lowest values.
- Average volume and turnover.

The simple average of the latest $n$ completed monthly closes is:

$$
\operatorname{SMA}_n=\frac{1}{n}\sum_{j=1}^{n}C_j
$$

$C_j$ is a completed month's close. An indicator returns null when history is insufficient; wait for valid data instead of substituting zero.

## Pre-run checks

1. Required stock or ETF daily bars are loaded.
2. The weekly or monthly window has enough history.
3. The code handles null indicators explicitly.
4. Long-timeframe conditions and daily actions are not confused.
5. The backtest range includes a sufficient warm-up period.
6. Trades still follow next-open execution, T+1, suspension, price-limit, and cost rules.

## Common misunderstandings

### Does a monthly condition run on only one day per month?

Not necessarily. After a new completed month appears, its indicator can remain a filter on subsequent trading days. The strategy's schedule determines whether orders occur only on rebalance dates.

### Does every Friday produce a weekly bar?

Not necessarily. The period ends on the last trading day in the calendar; holidays and closures can change that date.

### Does weekly data make a backtest more accurate?

Not automatically. It expresses another observation horizon but still requires sample, cost, sensitivity, and out-of-sample checks.

## Related articles

- [Create a backtest from a strategy description](/docs/help/backtesting/create-from-description)
- [Set backtest parameters](/docs/help/backtesting/run-settings)
- [Strategy SDK reference](/docs/sdk)
