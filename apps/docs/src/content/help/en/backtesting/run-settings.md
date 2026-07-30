# Set backtest parameters

Run parameters determine the historical dates, capital, and simulated execution costs. The same strategy can produce a different result when these settings change.

## Open the run parameters

1. Open a strategy.
2. Select **Edit run parameters** in the upper-right area.
3. Check every field before selecting **Run backtest**.

The numbered controls are:

1. Start date.
2. End date.
3. Initial capital, in ten-thousands of yuan.
4. Base slippage, in bp.
5. Impact coefficient.
6. **Run backtest**.

![Dates, capital, base slippage, impact coefficient, and Run backtest](/docs/images/help/zh/backtesting/run-settings-01.png)

## Start and end dates

- The start date determines when historical data and account value calculations begin.
- The end date determines when the run stops.
- The period must contain trading days and the data required by the strategy.
- Before comparing two results, confirm that their date periods match.

A short period may not offer enough opportunities for the rules to trigger. A long period takes more time and may cover market conditions for which the rules were not designed.

## Initial capital

Capital is entered in units of ten thousand yuan. For example, `200` means CNY 2 million.

Capital can affect:

- Whether the account can buy one board lot.
- The size of each trade relative to the account.
- Estimated market impact.
- Filled quantity and turnover.

## Base slippage

Base slippage simulates the difference between a calculation price and an execution price. It is entered in bp.

- `1 bp` is `0.01%`.
- A larger value normally makes simulated execution less favorable.
- Setting slippage to zero creates a more optimistic result; it does not mean live trading has no spread.

## Impact coefficient

The impact coefficient simulates the additional price effect of an order that is large relative to market turnover. Larger orders and less liquid instruments can have a greater effect.

Keep the default for a first run. When comparing strategies, use the same cost assumptions.

## Strategy parameters

The `params` object in the code contains strategy-specific values, such as order quantity, moving-average length, or number of holdings. These are different from dates, capital, and costs.

Run the backtest again after changing a code parameter. Use **Parameter scan** when you need to compare several values; the advanced guide will cover that workflow.

## Pre-run checklist

Confirm that:

- The start date is not after the end date.
- Capital was entered in the correct unit.
- Slippage and impact were not accidentally set to zero.
- Data exists for the instruments and dates in the code.
- Compared results use the same cost assumptions.

## Related articles

- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Dates, capital, and trading costs](/help/basics/backtest-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)

