# Inspect backtest results

Do not read return in isolation. First confirm that the period and trades are valid, then inspect return, risk, costs, and the account-value path together.

## Results area

The numbered areas are:

1. Main metrics.
2. Equity or drawdown chart.
3. Trades, with the fill count in parentheses.
4. Logs for the completed run.

![Backtest metrics, chart, trades, and logs](/docs/images/help/zh/backtesting/results-overview-01.png)

## Recommended reading order

1. Confirm the strategy name, dates, and capital.
2. Check the number of trades to verify that the rules actually triggered.
3. Read total and annualized return.
4. Read maximum drawdown and Sharpe.
5. Read excess return, information ratio, and the benchmark line.
6. Read fees, slippage loss, and turnover.
7. Open Trades and verify the actual fills.

When there are no trades, the displayed return normally cannot be used to judge a trading rule. Check whether conditions triggered, capital was sufficient, and data was available.

## Return metrics

- **Total return**: account return from the start to the end.
- **Annualized return**: period return expressed on an annual basis for comparing periods of different lengths.
- **Excess return**: the difference between the strategy and the built-in performance benchmark.
- **Final value**: total account value at the end of the backtest.

The built-in excess-return and information-ratio calculations use the CSI 300 **total-return** index. This matches the dividend-adjusted strategy equity convention; comparing it with the CSI 300 price index would otherwise give the strategy an artificial dividend advantage.

Annualized return is not a forecast. Annualizing a short period can produce an especially misleading number.

## Risk and supporting metrics

- **Maximum drawdown**: the largest decline from a prior account-value peak.
- **Sharpe**: return relative to volatility; it does not replace checking drawdown and sample size.
- **Information ratio**: excess return relative to tracking variation.
- **Calmar**: annualized return relative to maximum drawdown.
- **Win rate**: the share of completed trades that were profitable.
- **Profit factor**: the relationship between gross profits and gross losses.
- **Annual turnover**: an approximate annualized portfolio turnover multiple.

A strong value in one metric does not make a strategy reliable. Always consider the period, observations, drawdown, costs, and trade records.

## Cost metrics

- **Fees** include commissions, stamp duty, and other explicit costs used by the calculation.
- **Slippage loss** is caused by the simulated difference between calculation and execution prices.

Low costs may mean few trades or unrealistically low assumptions. Check the run parameters before drawing a conclusion.

## Compare two reports temporarily

After saving at least two backtests, choose report A at the top of the results area, click **Compare**, and then choose report B. The page temporarily shows total return, Sharpe, maximum drawdown, trades, each B − A difference, and both equity curves rebased independently to 100.

The comparison exists only on the current page. It creates no saved record and ends when you exit comparison or leave the page; the underlying reports remain immutable.

## Run again after a change

After changing code, dates, capital, or costs, **Run backtest** becomes available again. Only the next completed result reflects those changes.

When comparing results, record every setting rather than only the return.

A multi-asset strategy using a published Panel Factor also shows Factors used by this backtest and Multi-asset allocation attribution. The first verifies frozen Factor ID and code hash; the second explains actual return, risk, cost, correlation, and rate regimes. With sufficient coverage, Risk research adds market exposures, macro sensitivity, Alpha overlap, and stress scenarios.

## Related articles

- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)
- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Return and risk metrics](/help/basics/performance-risk)
- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
- [Read portfolio risk diagnostics](/docs/help/backtesting/portfolio-risk)
