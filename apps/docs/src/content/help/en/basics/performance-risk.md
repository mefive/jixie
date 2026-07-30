# Return and risk metrics

Return metrics describe how much the strategy made historically. Risk metrics describe the fluctuations and losses experienced along the way. Read both.

## Total return

Total return is the change in strategy equity from the beginning to the end of the backtest. It does not adjust for the length of the period.

## Annualized return

Annualized return expresses the growth rate as a yearly rate. Short backtests can produce unstable annualized numbers, especially when there are few trades.

## Excess return

Excess return is strategy total return minus benchmark total return. A strategy can make money and still have negative excess return if the benchmark gained more.

## Maximum drawdown

Maximum drawdown is the largest decline from a historical equity peak to a later low. A -20% historical drawdown does not mean future losses cannot exceed 20%.

Use the Drawdown tab in the result overview to inspect when declines occurred.

## Supporting metrics

- **Sharpe** compares return with overall volatility.
- **Information ratio** compares excess return with the volatility of excess return.
- **Win rate** is the share of completed trades that were profitable.
- **Profit/loss ratio** compares the average gain with the average loss.
- **Turnover** indicates how frequently holdings were traded.

These metrics are less informative when the period is short or the trade count is small.

## Recommended reading order

1. Trade count.
2. Total return and ending equity.
3. Benchmark and excess return.
4. Maximum drawdown and the drawdown chart.
5. Turnover, fees, and slippage loss.
6. Individual trades.

## Related articles

- [Run your first backtest](/help/getting-started/first-backtest)
- [Dates, capital, and trading costs](/help/basics/backtest-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
