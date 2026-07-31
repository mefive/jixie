# Compare several strategy parameters

A parameter scan runs the same strategy code with several parameter values and compares the results. Numeric values test whether a result depends on one unusually favorable setting; string values can represent sizing schemes.

## Before starting

The strategy must declare finite numbers or non-empty strings under `params` and use them through `ctx.params`. For example, a lookback, order quantity, and sizing scheme can be declared as `lookback`, `shares`, and `sizing`.

A scan does not rewrite strategy code or replace the normal backtest shown under Overview. One scan supports up to two parameters and 25 combinations, run sequentially in the background.

## Enter scan settings

1. Open a saved strategy.
2. Confirm that its code has numeric or string parameters that can be scanned.
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

![Two parameters, sample split option, and Start scan button](/docs/images/help/zh/backtesting/parameter-scan-settings-01.png)

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

![Metric selection, combination chart, and table for four scan results](/docs/images/help/zh/backtesting/parameter-scan-results-01.png)

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

## Compare sizing schemes

Declare the position-sizing choice as a string while keeping the entry and exit rules unchanged:

```ts
params: { sizing: 'atr', riskPct: 0.01, fixedLots: 10 }
```

Branch on `ctx.params.sizing` for equal weight, fixed lots, or ATR risk sizing. In the scan dialog choose **Sizing comparison**, select `sizing`, and enter `equal, fixed, atr`. A comparison accepts two to five schemes and does not combine with a sample split.

The result overlays NAV rebased to 1 and compares annual return, maximum drawdown, annual volatility, longest underwater trading period, and Sharpe. It changes only the declared sizing branch and never rewrites entry or exit logic.

## Estimate strategy capacity

A capacity estimate asks when growing capital begins to erode returns through market impact. It does not require declared strategy parameters. Open the scan dialog, choose **Capacity estimate**, and enter three to seven capital levels in CNY 10,000 units, for example `50, 200, 1000, 5000, 20000`.

Every level uses the same strategy code, date range, and cost model while changing only initial capital. The result plots annual return and annualized slippage drag, then identifies:

- The smallest capital level used as the baseline.
- The first level where annualized slippage drag reaches 1%.
- The first level where annual return falls to half the small-capital baseline.

**Not reached** means the largest entered level did not cross that threshold; it does not mean the strategy has unlimited capacity. The estimate depends on turnover, traded liquidity, board-lot constraints, and the configured cost model. A fixed-share strategy will also reduce its invested fraction as capital grows, so confirm that its order-sizing logic represents the scaling behavior you intend to study.

## Related articles

- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
- [Inspect backtest results](/help/backtesting/results-overview)
- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)
