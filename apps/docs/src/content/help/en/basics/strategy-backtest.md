# Strategies and backtests

A strategy is a set of explicit trading rules. A backtest applies those rules to historical data and calculates the result.

## What a strategy specifies

A complete strategy should state:

- What to trade.
- When to check the conditions.
- When to buy or sell.
- How much to trade.

“Buy 100 shares of Kweichow Moutai on the first trading day of each month” identifies the instrument, timing, and quantity, but has no sell rule. It is useful for learning the workflow, not a complete investment plan.

Strategies are created in Backtest Lab using a description or code.

## What a backtest does

For each historical trading day, a backtest checks the strategy, creates orders, applies trading rules and costs, updates cash and holdings, and then calculates performance.

Inspect metrics, the equity curve, logs, and trades together. A return number alone does not confirm that the rules ran as intended.

## What a benchmark is

A benchmark is a market reference. The CSI 300 helps compare the strategy with the market over the same period.

Excess return is strategy return minus benchmark return. Positive excess return does not guarantee that the strategy itself made money.

## Common misunderstandings

- More complicated rules are not automatically better and can fit one historical period too closely.
- A profitable backtest does not mean live trading will produce the same result.
- A run without errors can still have zero trades or the wrong quantities. Always inspect the trade list.

## Related articles

- [Run your first backtest](/help/getting-started/first-backtest)
- [Dates, capital, and trading costs](/help/basics/backtest-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
