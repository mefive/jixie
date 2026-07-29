# Understand the Backtest workspace

The Backtest workspace is where you write a strategy, choose a historical period, run the backtest, and inspect its result. Learn the page areas before changing a strategy.

## Open the workspace

1. Sign in and select **Backtest** in the top navigation.
2. Select **New** to create a strategy.
3. Describe the rules in the input, or choose to write the code directly.
4. Reopen a saved strategy from **History**.

If you only want to complete the basic workflow first, follow [Run your first backtest](/help/getting-started/first-backtest).

## Page areas

The numbered areas are:

1. **Strategy conversation and history**: check the strategy name, request a change, reopen a saved strategy, or create one.
2. **Strategy code**: the rules that the backtest actually executes. Direct code editing is an advanced operation.
3. **Results**: edit run settings, start a backtest, and inspect metrics, charts, and trades.
4. **Logs**: system progress and any `console` output produced by the strategy.

![Strategy, code, results, and logs in the Backtest workspace](/help/zh/backtesting/workspace-01.png)

Drag the dividers to resize the areas. On a narrow screen, collapse an area you do not currently need.

## How the description relates to the code

After you describe a strategy on the left, its code appears in the middle. The middle code—not the displayed name—is what the backtest executes. Before running, verify at least:

- The stock or ETF code.
- Buy, sell, and rebalance conditions.
- Quantity, frequency, and date logic.
- Parameters used by the strategy.

If the rules differ from your description, request the required change before running the backtest.

## Open a historical strategy

1. Select **History** on the left.
2. Select the strategy you want.
3. Wait for its name, code, and previous result to load.
4. Check whether the displayed dates and capital still fit the run you intend to make.

After changing code or run settings, run the backtest again. The previous result does not represent changes that have not been run.

## Common problems

### The new-strategy page is not visible

The workspace may automatically reopen a recent strategy. Select **New** in the upper-left area to create another one.

### A warning says there are unrun changes

The code or settings have changed but have not been used in a completed backtest. Run the backtest if you want to keep the changes; discard them only when they are not needed.

### The code is unfamiliar

Start by checking the name, security code, direction, quantity, and frequency. You do not need to understand every line for the first run. See the [Strategy SDK](/docs) when you are ready to edit code directly.

## Related articles

- [Set backtest parameters](/help/backtesting/run-settings)
- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Strategies and backtests](/help/basics/strategy-backtest)

