# Use a custom factor in a strategy

After a custom factor has completed an analysis and received a locked strategy key, a backtest can read its values, rank stocks, and select holdings.

## Before you start

Confirm that:

- The custom factor has completed an analysis successfully.
- Its page shows a complete locked strategy key.
- You know what high and low factor values mean.
- An editable strategy is available in the Backtest workspace.

This article uses:

```text
custom:help_book_to_market
```

Replace it with the complete key displayed on your factor page.

## Declare and read the factor

The strategy must do both of the following:

1. Declare the factor in the top-level `factors` array.
2. Read each stock's value with `ctx.factor` in the selection logic.

This example selects the ten stocks with the highest book-to-market values from the CSI 300 each month and holds them at equal weights:

```ts
let last = '';

export default defineStrategy({
  name: 'Book-to-market factor example',
  factors: ['custom:help_book_to_market'],

  async onBar(ctx) {
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');

    const universe = (await ctx.universe('000300.SH')).minListDays(365);
    await ctx.ensureBars(universe.codes());

    const picks = universe
      .rankBy((_bar, code) =>
        ctx.factor('custom:help_book_to_market', code),
      )
      .top(10);

    if (picks.length) ctx.equalWeight(picks);
  },
});
```

In this code:

- `factors` tells the backtest runtime which custom factor to load.
- `ctx.ensureBars` prepares historical price data for the stocks.
- `ctx.factor(key, code)` returns the stock's factor value on the current backtest date.
- `rankBy(...).top(10)` ranks from high to low and keeps the first ten.
- A stock is excluded from the valid ranking when the factor returns `null` or a non-finite number.

The numbered areas are:

1. Current strategy.
2. Top-level `factors` declaration.
3. `ctx.factor` in the selection logic.
4. **Run backtest**.

![Reference a custom factor in the declaration and selection logic](/docs/images/help/zh/factors/factor-strategy-reference-01.png)

The complete key, including the `custom:` prefix, must match in both places.

## Verify the factor in the editor

Hover over the complete factor key in strategy code. The editor displays the factor name, type, and a link to its implementation.

The numbered areas are:

1. Factor key in the code.
2. Factor details and implementation link.

![Inspect factor details and the implementation link in the strategy editor](/docs/images/help/zh/factors/factor-strategy-hover-01.png)

Use this information before running to confirm that:

- This is the intended factor, not another factor with a similar name.
- The key exists.
- The implementation can be opened when it needs review.

## Run and inspect the result

1. Set the backtest start date, end date, and initial cash.
2. Select **Run backtest**.
3. Confirm in the log that the run completed without a factor-loading or calculation error.
4. Inspect the result summary, trades, and equity chart.

The numbered areas are:

1. Date summary for this run.
2. Return, risk, turnover, cost, and trade metrics.
3. Trades tab and trade count.
4. Strategy and benchmark curves.

![A completed backtest that uses the custom factor](/docs/images/help/zh/factors/factor-strategy-result-01.png)

Trades show that the strategy read the factor and selected stocks. They do not establish that the factor is suitable for live trading. Also check:

- The ranking direction matches the factor definition.
- Stocks without valid values are excluded.
- The universe, rebalance frequency, and number of holdings are correct.
- Trading costs, turnover, and drawdown are acceptable.
- Results remain stable across other periods and a formal holdout.

## Common questions

### The factor cannot be found

Confirm that the key is locked and that the complete `custom:` prefix was copied. Do not use the factor's display name as the code key.

### The factor is declared but cannot be read

The strategy logic must also call `ctx.factor`. The declaration loads the factor; `ctx.factor` reads a value for a stock.

### `ctx.factor` is present but the run still fails

Confirm that the same complete key also appears in the top-level `factors` array and that both strings match exactly.

### The backtest has no trades

Inspect the log first. Then check that the date range has enough valid factor values, the universe is not empty, and `top` or other filters are not too restrictive.

### Does editing factor code require a new strategy key?

No. The locked key remains unchanged. Run a new factor analysis and backtest so that the new results correspond to the new code.

## Related articles

- [Confirm the strategy key](/docs/help/factors/strategy-key)
- [Set backtest run parameters](/docs/help/backtesting/run-settings)
- [Read the backtest result summary](/docs/help/backtesting/results-overview)
- [Formal holdout and out-of-sample results](/docs/help/factors/holdout-results)
