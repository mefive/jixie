# Read equity, drawdown, and monthly returns

Charts show how a result developed. The same final return can come from a steady path or from a deep loss followed by a recovery.

## Switch between equity and drawdown

1. Open **Overview**.
2. Select **Equity** to view account value over time.
3. Select **Drawdown** to view each day's decline from the previous peak.
4. Scroll down to view monthly returns.

In the image, **1** is the drawdown chart and **2** is the monthly-return table.

![Drawdown chart and monthly returns in a backtest result](/help/zh/backtesting/equity-drawdown-01.png)

## Read the equity chart

- **Strategy equity** is account value over time.
- The default benchmark is CSI 300, rebased to the strategy's starting value.
- Lines are comparable only when they share the same dates and starting basis.
- A high ending value does not mean the path avoided large losses.

Use the benchmark filter in the upper-right of the chart to select another index. Changing the benchmark changes how excess and relative performance should be interpreted.

## Read the drawdown chart

Drawdown starts at 0% and extends downward:

- **Peak** is the account-value high before the decline.
- **Trough** is the lowest point in that drawdown.
- **Recovery** is when account value returns to the previous high.
- **Not recovered** means the account was still below that high on the end date.

A deeper maximum drawdown means a larger historical account loss. Duration also matters; do not inspect only the lowest point.

## Read monthly returns

The table is organized by year and month:

- Red means a positive return.
- Green means a negative return.
- Darker color means a larger absolute monthly change.
- `+4.0` means approximately `+4.0%` for that month.
- The final column is the compounded return for the year.

Check whether most of the result came from only one or two months. If so, inspect what happened in those months.

## Avoid invalid comparisons

- Do not compare chart endpoints from different date ranges.
- Do not confuse account value with return percentage.
- Do not select only the most favorable benchmark.
- Do not assume a future drawdown will recover in the same amount of time.

## Related articles

- [Inspect backtest results](/help/backtesting/results-overview)
- [Return and risk metrics](/help/basics/performance-risk)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)

