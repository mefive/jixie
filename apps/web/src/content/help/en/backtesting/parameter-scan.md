# Compare several strategy parameters

A parameter scan runs the same strategy code with several numeric parameter values and compares the results. Use it to check whether a result depends on one unusually favorable value.

## Before starting

The strategy must declare numeric values under `params` and use them through `ctx.params`. For example, a lookback period and order quantity can be declared as `lookback` and `shares`.

A scan does not rewrite strategy code or replace the normal backtest shown under Overview. One scan supports up to two parameters and 25 combinations, run sequentially in the background.

## Enter scan settings

1. Open a saved strategy.
2. Confirm that its code has numeric parameters that can be scanned.
3. Select **Parameter scan** at the top.
4. Choose the first parameter and enter at least two comma-separated values.
5. To compare two parameters, select **Scan a second parameter** and enter its values.
6. To inspect out-of-sample performance, enable the in-sample/out-of-sample option and choose a split date.
7. Check the number of combinations, then select **Start scan**.

The numbered areas show:

1. The first parameter and its values.
2. The second parameter and its values.
3. The in-sample/out-of-sample option.
4. The **Start scan** button.

![Two parameters, sample split option, and Start scan button](/help/zh/backtesting/parameter-scan-settings-01.png)

For example, values `2, 3` in the first dimension and `100, 200` in the second produce `2 × 2 = 4` combinations.

## Wait for completion

Open the **Parameter scan** tab in the results area. Logs show the current progress. Do not submit the same scan again while it is running.

More combinations, longer date ranges, and strategies that process more instruments take longer.

## Read scan results

The numbered areas show:

1. Scan history, used to reopen an earlier scan.
2. The comparison metric, such as annualized return or Sharpe.
3. The parameter combination chart.
4. The table containing each combination.

![Metric selection, combination chart, and table for four scan results](/help/zh/backtesting/parameter-scan-results-01.png)

Review the result in this order:

1. Confirm the completion time in scan history.
2. Check the combination count, code identifier, and data cutoff.
3. Choose the metric to compare.
4. Use the chart to see whether neighboring values have similar results.
5. Verify every exact value in the table.

The example uses a short period, so its annualized returns demonstrate the interface only and should not be used to assess a strategy.

## In-sample and out-of-sample periods

When a split is enabled:

- **In sample** is used to inspect and choose parameters.
- **Out of sample** checks the chosen parameters on a later period that was not used for selection.
- **Full sample** reports the entire date range.

Do not repeatedly alter parameters after reading the out-of-sample result and continue calling the same period out of sample. Those observations have then influenced parameter selection.

## Assess parameter stability

Check:

- Whether neighboring values produce results in roughly the same direction.
- Whether higher return also brings deeper drawdown or more trades.
- Whether only one narrow value produces a sudden improvement.
- Whether out-of-sample performance is much weaker than in-sample performance.
- Whether the result remains viable with higher costs.

A parameter scan cannot prove that a strategy will work in the future. It can expose parameter sensitivity and signs of overfitting, which must still be checked against trades, different market periods, and reasonable costs.

## Related articles

- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
- [Inspect backtest results](/help/backtesting/results-overview)
- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)

