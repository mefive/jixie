# Dates, capital, and trading costs

Dates, starting capital, and trading costs determine which data is used, what can be bought, and the cost of each trade. Keep them consistent when comparing results.

## Backtest dates

Start and end dates define the historical period.

- A short period runs quickly but may contain only one type of market.
- A longer period can include rising, falling, and sideways markets.
- The range must contain available trading days.

Weekends and market holidays are not treated as trading days.

## Capital

Capital is the cash available at the beginning. The field uses units of ten thousand yuan, so `100` means CNY 1 million.

Capital affects whether the requested quantity can be bought, the importance of fixed costs, and estimated market impact.

## Base slippage

Base slippage simulates the difference between a reference price and a fill price. Buys are generally estimated higher and sells lower.

Setting slippage to zero is an idealized assumption, not evidence that live trading has no price difference.

## Impact coefficient

The impact coefficient estimates additional price movement when an order is large relative to market volume. Large orders and illiquid instruments are usually affected more.

## Compare results consistently

Before comparing two runs, check:

1. Start and end dates.
2. Starting capital.
3. Benchmark.
4. Base slippage and impact coefficient.
5. Other fee settings.

Different settings can create different results even when the strategy rules are unchanged.

## Related articles

- [Run your first backtest](/help/getting-started/first-backtest)
- [Return and risk metrics](/help/basics/performance-risk)
