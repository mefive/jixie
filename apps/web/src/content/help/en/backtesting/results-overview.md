# Inspect backtest results

Do not read return in isolation. First confirm that the period and trades are valid, then inspect return, risk, costs, and the account-value path together.

## Results area

The numbered areas are:

1. Main metrics.
2. Equity or drawdown chart.
3. Trades, with the fill count in parentheses.
4. Logs for the completed run.

![Backtest metrics, chart, trades, and logs](/help/zh/backtesting/results-overview-01.png)

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
- **Excess return**: the difference between the strategy and selected benchmark.
- **Final value**: total account value at the end of the backtest.

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

## Run again after a change

After changing code, dates, capital, or costs, **Run backtest** becomes available again. Only the next completed result reflects those changes.

When comparing results, record every setting rather than only the return.

## Related articles

- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)
- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Return and risk metrics](/help/basics/performance-risk)

