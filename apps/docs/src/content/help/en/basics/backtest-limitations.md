# Why a backtest is not a forecast

A backtest answers what a rule would have produced on available historical data. It does not say what the rule will earn in the future.

## Market conditions change

Businesses, participants, trading rules, interest rates, and liquidity change. A historical relationship can weaken, disappear, or reverse.

## Look-ahead bias

Look-ahead bias occurs when a strategy uses information that was not available on the historical decision date. Real historical data can still cause look-ahead bias if the strategy sees it before its original publication date.

## Survivorship bias

Survivorship bias occurs when a historical test uses only securities that still exist today and omits delisted or removed securities. Long-term stock universes should change with historical dates.

## Overfitting

Overfitting occurs when rules and parameters are repeatedly changed until they fit one historical period.

Warning signs include:

- Small date changes produce very different results.
- A small parameter change removes the apparent advantage.
- Many conditions were added to explain individual historical events.
- The best result from repeated tests is presented without a separate test period.

Keep an out-of-sample period that is not used for parameter selection.

## Simulated and live fills differ

Live trading can encounter suspensions, price limits, T+1 rules, lot-size rules, commissions, stamp duty, slippage, market impact, and operational delays.

Even when a backtest models these items, the model is an estimate. Differences matter more for large capital, high turnover, and illiquid securities.

## Use results carefully

1. Test across different market periods.
2. Verify individual trades.
3. Use reasonable slippage, impact, and fees.
4. Change dates and parameters slightly to check stability.
5. Keep an out-of-sample period.
6. Review drawdown, trade count, and costs, not only return.
7. Treat a backtest as historical evidence, not a promise.

## Related articles

- [Strategies and backtests](/help/basics/strategy-backtest)
- [Dates, capital, and trading costs](/help/basics/backtest-settings)
- [Return and risk metrics](/help/basics/performance-risk)
