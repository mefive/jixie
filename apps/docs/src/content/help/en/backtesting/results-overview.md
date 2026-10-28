# Inspect backtest results

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Do not read return in isolation. First confirm that the period and trades are valid, then inspect return, risk, costs, and the account-value path together.

## Results area

The numbered areas are:

1. Main metrics.
2. Equity or drawdown chart.
3. Trades, with the fill count in parentheses.
4. Logs for the completed run.

![Historical Chinese UI example: Backtest metrics, chart, trades, and logs](/docs/images/help/zh/backtesting/results-overview-01.png)

## Recommended reading order

1. Confirm the strategy and the actual period and capital shown with the latest result. The top run settings belong to the current draft and may have changed.
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

Low costs may mean few trades or unrealistically low assumptions. Check the cost configuration saved with the selected report before drawing a conclusion. The top run settings may have changed and should not be used to explain an old report.

## Retain the latest result and continue research

Each strategy retains its latest submitted backtest and active jobs. Resubmission removes older results, Jobs and logs, even when the new run fails. Scans retain their own latest submission independently.

Select **Analyze result in Research** to create a document reading the retained result, or reference the current report in the conversation and ask the Agent to analyze its metrics, NAV or trades. These calculations neither rerun the strategy nor expose old strategy source. Python references fail explicitly after the report is removed.

The editor and run settings always describe the current draft. Rerun after changing code or settings. Current code is never substituted into a previous result. Published Factor version references remain available.

## Run again after a change

After changing code, dates, capital, or costs, **Run backtest** becomes available again. Only the next completed result reflects those changes.

When comparing results, record every setting rather than only the return.

Strategies using factors show their frozen Factor IDs and code hashes. Every new backtest provides cash-account allocation attribution for stock / ETF returns, risk, and costs. Class correlation and rate-regime diagnostics require classifications and sufficient data.

## Related articles

- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)
- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Return and risk metrics](/help/basics/performance-risk)
- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
