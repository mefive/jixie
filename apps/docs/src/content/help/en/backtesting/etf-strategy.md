# Run an ETF strategy

ETFs can be bought and sold in a backtest in much the same way as stocks. For a first ETF strategy, start with the **Major ETF rotation** example, then verify its instruments, rebalance frequency, and ranking rule.

## Start from the example

1. Sign in and open the Backtest workspace.
2. Select **New**.
3. Select **Major ETF rotation**, marked **3** below.
4. Wait for the strategy name and code to appear.
5. Check the ETF list, lookback period, number held, and rebalance frequency.
6. Set dates, capital, and costs.
7. Select **Run backtest**.

The numbered areas show:

1. The new strategy page.
2. The strategy description input.
3. The **Major ETF rotation** example.
4. The direct-code entry for users familiar with the Strategy SDK.

![Major ETF rotation on the new strategy page](/docs/images/help/zh/backtesting/etf-entry-01.png)

The example uses major ETFs that are currently synchronized. Always verify the instrument codes in the resulting strategy instead of relying on its name.

## What ETF rotation means

An ETF rotation strategy usually compares a fixed list on a schedule and holds one or more of them. For example:

1. Calculate each ETF's return over the previous 60 trading days each month.
2. Rank the ETFs from highest to lowest.
3. Hold the top two with equal weights.
4. Compare and rebalance again the next month.

Strong recent performance is only a historical ranking condition; it does not imply continued gains. Test lookback length, number held, and rebalance frequency across different periods and costs.

## Verify ETF trades

After the run:

1. Open **Trades**.
2. Check instrument count, buys and sells, turnover, fees, and slippage.
3. Confirm that the instrument name and code carry an **ETF** label.
4. Check that buy and sell dates follow the rebalance rule.
5. Check that quantities agree with capital and strategy settings.

The numbered areas show:

1. The Trades tab and fill count.
2. The fill summary.
3. Instrument, direction, and asset filters.
4. ETF buy and sell records.

![ETF fill summary, filters, and buy and sell records](/docs/images/help/zh/backtesting/etf-trades-01.png)

The example has one buy and one sell. Review fees, slippage, and final return together; prices alone do not describe the complete result.

## If no ETF trade appears

Check:

- Whether the ETF code is correct and has data in the period.
- Whether the lookback requires more history than is available.
- Whether a rebalance condition occurs within the period.
- Whether initial capital is sufficient.
- Whether order quantities are valid.
- Whether logs report a data or code error.

In a ranked rotation strategy, an ETF without a trade may simply never have entered the selected group.

## Compare ETF strategies

Keep these settings consistent:

- ETF list.
- Start and end dates.
- Initial capital.
- Rebalance frequency.
- Base slippage and impact coefficient.
- Comparison metric and benchmark.

Also inspect maximum drawdown, turnover, costs, and fills by ETF. A strategy with higher return and frequent rebalancing may deteriorate substantially under reasonable costs.

## Related articles

- [Stocks, ETFs, and indices](/help/basics/stocks-etfs-indices)
- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Compare several strategy parameters](/help/backtesting/parameter-scan)

