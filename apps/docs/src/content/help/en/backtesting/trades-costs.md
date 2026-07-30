# Inspect trades and costs

Trade records show what the strategy actually filled. A valid chart does not guarantee that every fill matched the intended rules, so inspect dates, directions, quantities, and costs after a run.

## Open trades from the result

1. After completion, select **Trades (count)**.
2. Inspect the summary and records inside the workspace.
3. Select **Open in page** for a wider table. It is marked **4** below.

In the image, **1** is the fill summary, **2** contains filters, and **3** is the fill list.

![Trades tab, fill summary, filters, and Open in page](/docs/images/help/zh/backtesting/trades-01.png)

## Use the full Trades page

The full page is better for reviewing a table with many columns:

1. The title shows the strategy and number of fills.
2. The summary shows instrument count, buy and sell counts, turnover, fees, slippage, and average fill size.
3. Filter by instrument, direction, or asset type.
4. The ledger contains the fields for each fill.

![Strategy, fill summary, filters, and ledger on the full Trades page](/docs/images/help/zh/backtesting/trades-page-01.png)

## Column meanings

- **Instrument**: name, security code, and asset type.
- **Date**: simulated execution date.
- **Direction**: buy or sell.
- **Quantity / contracts**: quantity for stocks and ETFs, contracts for futures.
- **Price**: simulated execution price after slippage.
- **Amount**: notional value of the fill.
- **Fee**: commissions, stamp duty, and other explicit costs.
- **Slippage**: loss caused by the simulated execution-price difference.

## Filter fills

For a long ledger:

1. Select one instrument.
2. Show only buys or sells.
3. Separate stocks, ETFs, and futures.
4. Clear filters to restore all records.

Filters change only the displayed rows. They do not rerun the backtest or change its result.

## Verify the rules

Check at least:

- Whether the first fill date matches the strategy's entry condition.
- Whether directions match the rules.
- Whether capital and board-lot rules changed the quantity.
- Whether unexpected duplicate fills occurred.
- Whether fees and slippage are reasonable non-negative values.
- Whether the number of fills is broadly consistent with the strategy frequency.

If the code should trade but the ledger is empty, check logs, dates, instrument data, capital, and trading restrictions.

## No trade records

The Trades tab is absent when there are no fills. Common causes include:

- Conditions did not trigger in the period.
- Capital was insufficient.
- The instrument had no usable data.
- Quantity did not meet the trading unit.
- Orders were blocked by price limits or other execution rules.

Zero fills are not evidence of a successful strategy. Find the cause before evaluating performance.

## Related articles

- [Inspect backtest results](/help/backtesting/results-overview)
- [Set backtest parameters](/help/backtesting/run-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)

