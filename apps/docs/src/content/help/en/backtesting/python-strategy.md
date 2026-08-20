# Write a strategy in Python

The backtest workspace supports TypeScript and Python. Both languages use the same engine for market data, fills, costs, T+1, and price-limit rules, so changing language does not change trading rules.

## Switch the strategy language

1. Open Backtest and create a strategy or open an unrun draft.
2. Choose Python in the language control above the editor.
3. Confirm the switch. The page replaces the current code with the Python template.
4. Check that the editor shows `py-v1` and “Stock / ETF backtest preview.”

Switching replaces unsaved code. Copy important code elsewhere or run and save the current version first.

![Python editor and run action in the backtest workspace](/docs/images/help/zh/backtesting/python-strategy-01.png)

## A runnable example

These examples express the same rule: after 20 historical observations are available, target a 50% position in Kweichow Moutai. Use the tabs to compare the two languages.

:::code-tabs
```typescript
let ordered = false;

export default defineStrategy({
  name: '20-day history example',
  async onBar(ctx) {
    const closes = ctx.history('600519.SH', 'close', 20);
    if (!ordered && closes.length === 20) {
      ctx.orderTargetPercent('600519.SH', 0.5);
      ordered = true;
    }
  },
});
```
```python
from jixie import Strategy

strategy = Strategy(name="20-day history example", watch=["600519.SH"])
ordered = False

@strategy.on_bar
def handle_bar(ctx):
    global ordered
    closes = ctx.history("600519.SH", "close", 20)
    if not ordered and len(closes) == 20:
        ctx.order_target_percent("600519.SH", 0.5)
        ordered = True
```
:::

Python module variables persist for the full backtest. `ordered` prevents the example from sending the same intent every day.

## Available technical indicators

The Python daily SDK provides `sma`, `ema`, `atr`, `highest`, `lowest`, `avg_amount`, and `avg_vol`, plus:

- `ctx.adx(code, period=14)` returns `adx`, `positive_di`, and `negative_di`;
- `ctx.bollinger_bands(code, period=20, standard_deviations=2)` returns `middle`, `upper`, and `lower`;
- `ctx.rsi(code, period=14)` returns a value in [0, 100];
- `ctx.macd(code, fast_period=12, slow_period=26, signal_period=9)` returns `line`, `signal`, and `histogram`;
- `ctx.kdj(code, period=9, k_smoothing=3, d_smoothing=3)` returns `k`, `d`, and `j`.

Every value is calculated on demand from adjusted bars available through the current date; these are not stored indicator columns. Insufficient history returns `None`, so check composite results before reading their fields.

## Run and inspect the result

1. Open Edit launch parameters and set dates, capital, and costs.
2. Click Run backtest.
3. Inspect Python output and error line numbers in the log.
4. When metrics appear, verify trades, the ledger, and the equity curve.

![Metrics and logs after a Python backtest](/docs/images/help/zh/backtesting/python-strategy-02.png)

Python errors retain the `strategy.py` line number. Start with the first error rather than only the final exception name.

## Current scope

`py-v1` currently supports stocks and ETFs, daily history, common indicators, built-in factors, target weights, share orders, and conditional orders.

A Python Strategy generated from a promoted research version shows **From research version** above the editor. Use it to review
the distilled summary and unresolved items or return to the exact read-only research snapshot. Provenance does not mean the
strategy has been backtested, validated out of sample, or made deployable.

Python mode does not currently expose:

- index futures or mixed stock/futures strategies;
- custom TypeScript Factors;
- parameter scans;
- deployment and Today signals.

Hidden actions are product limits, not permission errors. Switch to TypeScript and rewrite against the TypeScript SDK when those capabilities are required.

## Related articles

- [Set backtest parameters](/docs/help/backtesting/run-settings)
- [Run a backtest and read logs](/docs/help/backtesting/run-and-logs)
- [Read backtest results](/docs/help/backtesting/results-overview)
