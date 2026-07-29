# Run an index futures strategy

Index futures use margin, and one contract usually represents a notional amount much larger than the margin posted. A contract can be long or short, and a small index move can produce a large account change. If you are new to futures, use historical tests to understand contracts, margin, and rolls; do not treat a backtest as live-trading advice.

## What to specify when creating the strategy

Include:

- The index futures product, such as CSI 300 index futures.
- Whether it is long, short, or changes direction under a rule.
- The number of contracts.
- When it opens, closes, or rebalances.
- Backtest dates and initial capital.

After the strategy appears, verify the declared futures code. `IF.CFX` is the CSI 300 index futures main-continuous code, not one fixed expiry month.

## Checks before running

1. Confirm that only the intended futures product is used.
2. Confirm that positive contracts buy and negative contracts sell.
3. Confirm that initial capital can cover margin and costs.
4. Check whether the period crosses an expiry or roll date.
5. Check slippage and fee settings.
6. Select **Run backtest**.

One futures contract is not one share. Products have different multipliers, margin rates, and prices.

## Inspect futures fills

Open Trades after completion. The numbered areas show:

1. The futures strategy code used by the run.
2. The fill summary.
3. Contract quantity, price, amount, fee, and slippage columns.
4. Futures fill records.

![Index futures strategy, fill summary, and actual monthly contracts](/help/zh/backtesting/futures-trades-01.png)

In the records:

- `IF.CFX` is the main-continuous code used by the strategy.
- An entry such as **actual IF2606.CFX** is the monthly contract used on that date.
- A quantity of `1` means one contract.
- Red Buy and green Sell show the fill direction.
- Fill amount is contract notional, not the margin posted.

## Why the example has four fills

The strategy requests one entry and one later exit, but the period crosses a main-contract roll. The engine sells the old monthly contract and buys the new one to maintain the position, creating additional roll fills.

Do not assume every extra fill is a repeated strategy order. Check the actual monthly contract shown beside each record to identify a roll.

Rolling increases fill count, fees, and slippage and is a real cost of using a continuous strategy.

## Margin, notional, and risk

- **Notional** is broadly determined by futures price, contract multiplier, and contract count.
- **Margin** is capital reserved to hold a contract; it is not the maximum possible loss.
- A **long** can lose when the index falls.
- A **short** can lose when the index rises.
- In live trading, insufficient margin can require more funds or force a position reduction. A backtest does not remove this risk.

Do not treat all cash not currently posted as margin as risk-free capital.

## Review order

1. Confirm the product and actual monthly contracts.
2. Check entries, exits, and roll fills.
3. Check contract count, direction, and notional.
4. Check fees, slippage, and turnover.
5. Review maximum drawdown and final equity.
6. Run again with higher costs.

## Related articles

- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Set backtest parameters](/help/backtesting/run-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)

