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

## Run and inspect the result

1. Open Edit launch parameters and set dates, capital, and costs.
2. Click Run backtest.
3. Inspect Python output and error line numbers in the log.
4. When metrics appear, verify trades, the ledger, and the equity curve.

![Metrics and logs after a Python backtest](/docs/images/help/zh/backtesting/python-strategy-02.png)

Python errors retain the `strategy.py` line number. Start with the first error rather than only the final exception name.

## Current scope

`py-v1` currently supports stocks and ETFs, daily history, common indicators, built-in factors, target weights, share orders, and conditional orders.

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
