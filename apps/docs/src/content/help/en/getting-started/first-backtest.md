# Run your first backtest

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

This example tests buying 100 shares of Kweichow Moutai on the first trading day of each month. You will set dates and capital, run the backtest, and inspect returns, risk, and trades.

## Before you start

- Sign in.
- A backtest applies rules to historical data. It is not a forecast.
- This example teaches the workflow and is not a recommendation of the stock or rule.

## Describe the strategy

1. Select Strategy.
2. Select New or open a new backtest.
3. Choose TypeScript or Python under Strategy language. New strategies default to Python. Select TypeScript for this walkthrough, or choose
   Python to have the Agent and editor use py-v1.
4. Enter `Buy 100 shares of Kweichow Moutai on the first trading day of each month` in **1**.
5. Press Enter or use the send button marked **2**.
6. Example descriptions appear in **3**.

![Strategy description, send button, and examples in Strategy](/docs/images/help/en/getting-started/first-backtest-01-prompt.png)

This capture shows the first-visit page with no recent strategies. With an existing strategy, select New to open the same input controls in a dialog.

Wait for the explanation on the left and strategy code in the center. Verify that the stock, quantity, and frequency match your description before running it.

py-v1 currently supports stock and ETF backtests. Futures, parameter scans,
and daily-signal deployments are not yet available. T+1, price limits, suspensions, board lots,
adjustments, and costs are still enforced by the same backtest engine.

## Set the backtest parameters

1. Select Edit run parameters.
2. Set the start date in **1**.
3. Set the end date in **2**.
4. Enter `100` in the capital field marked **3**. The unit is ten thousand yuan, so this means CNY 1 million.
5. Keep the default base slippage for this first run. It is marked **4**.
6. Select Run backtest, marked **6**; **5** is the impact coefficient.

![Dates, capital, base slippage, and Run backtest button](/docs/images/help/en/backtesting/run-settings-01.png)

This is the parameter panel of a saved strategy, shown to locate controls. Enter this tutorial’s settings before running. The return and trade figures below preserve the original historical example and belong to a different run.

The range must contain trading days, and capital must be sufficient for the requested purchase.

## Inspect the main metrics

1. Review the metrics in **1**.
2. Select the Trades tab marked **2** to verify the actual fill.
3. If the run fails, inspect the log area marked **3**.

![Historical Chinese UI example: Backtest metrics, Trades tab, and log area](/docs/images/help/zh/getting-started/first-backtest-03-metrics.png)

The captured example has a 1.05% total return and one trade. These values only describe the fixed historical period.

## Inspect the equity curve

1. The chart marked **1** compares strategy equity with the CSI 300 benchmark.
2. Use the tabs marked **2** to switch between equity and drawdown.

![Historical Chinese UI example: Strategy equity, CSI 300 benchmark, and result tabs](/docs/images/help/zh/getting-started/first-backtest-04-chart.png)

An upward ending equity curve does not mean the strategy made money at every point. Review drawdown and trades as well.

## Confirm that the run completed

- The result overview contains return and drawdown metrics.
- The Trades tab shows a trade count.
- The equity chart contains strategy and benchmark lines.
- No run-failed message is displayed.

If the trade count is zero, check the date range, capital, stock code, and whether the condition could occur.

## Related articles

- [Strategies and backtests](/help/basics/strategy-backtest)
- [Return and risk metrics](/help/basics/performance-risk)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
- [Write a strategy in Python](/docs/help/backtesting/python-strategy)
