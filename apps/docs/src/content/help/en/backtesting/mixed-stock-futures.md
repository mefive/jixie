# Run a mixed stock and futures strategy

A mixed strategy holds stocks and index futures at the same time. A common use is holding a stock portfolio while using short index futures to reduce broad market exposure. Hedging changes sources of risk; it does not guarantee against loss.

## Understand the two accounts

Initial capital is split into:

- A **stock account** for stock purchases and sales.
- A **futures account** for margin, futures profit and loss, and costs.

For example, 80% stock and 20% futures must add to 100%. The two accounts do not automatically transfer capital between each other during the backtest.

Too little futures capital may prevent the intended hedge; too much reduces capital available for stocks.

## Checks before running

1. Confirm the stock list and index futures product.
2. Confirm that stock and futures allocations add to 100%.
3. Check whether the futures position is long or short.
4. Check the hedge ratio.
5. Check capital, dates, and costs.
6. Run the backtest and wait for completion.

If the hedge is calculated after stock purchases, inspect actual stock fills rather than estimating the hedge only from target quantities.

## Read mixed-strategy metrics

The numbered areas show:

1. Stock account equity.
2. Futures account equity.
3. Futures margin.
4. Net exposure.

![Account equity, futures margin, and net exposure in a mixed backtest](/docs/images/help/zh/backtesting/mixed-results-01.png)

The metrics mean:

- **Stock account equity**: cash and stock market value in the stock account.
- **Futures account equity**: futures account capital plus futures profit and loss.
- **Futures margin**: margin currently reserved for futures positions.
- **Net exposure**: remaining market exposure after combining stock long notional with futures direction and notional.

Net exposure near zero indicates lower directional market exposure. It does not remove stock-selection risk, basis risk, roll costs, or transaction costs.

## Verify stock and futures fills

The numbered areas show:

1. The combined fill summary for both asset types.
2. Instrument, direction, and asset filters.
3. A stock fill.
4. Futures fills and actual monthly contracts.

![Stock and index futures records in mixed-strategy trades](/docs/images/help/zh/backtesting/mixed-trades-01.png)

Check:

1. That stocks filled as intended.
2. That futures count and direction match the hedge.
3. The actual monthly contract in each futures record.
4. Stock and futures separately with the asset filter.
5. Fees, slippage, and total turnover.

One stock fill and several futures fills are not necessarily inconsistent. A main-continuous future can create additional roll records.

## Why a hedged strategy can still lose

Common reasons include:

- The stock portfolio underperforms the index.
- Futures contracts are integers and cannot exactly match stock notional.
- Stocks and the index do not move identically.
- Futures prices differ from the spot index.
- Contract rolls, fees, and slippage create costs.
- Suspensions, price limits, or actual fill quantities alter stock exposure.

Review net exposure, both account equities, trades, equity, and drawdown together. A strategy name containing “hedged” is not evidence that risk has been removed.

## Compare hedge ratios

To compare hedge ratios:

1. Keep the stock rule, dates, capital, and costs the same.
2. Change only the hedge ratio.
3. Record total return, maximum drawdown, net exposure, and futures margin.
4. Check whether roll and trading costs rise with contract count.
5. Test again in different market periods.

A hedge ratio is a risk setting, not a guaranteed-return parameter. Do not select a value only because it has the highest historical return.

## Related articles

- [Run an index futures strategy](/help/backtesting/index-futures)
- [Read equity, drawdown, and monthly returns](/help/backtesting/equity-drawdown)
- [Compare several strategy parameters](/help/backtesting/parameter-scan)

