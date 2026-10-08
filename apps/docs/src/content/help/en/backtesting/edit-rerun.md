# Edit a strategy and run it again

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Changing code, dates, capital, or costs does not recalculate the result automatically. Run the backtest again before using the result to assess the change.

## Run after editing

1. Open the strategy.
2. Edit the code, or select **Edit run parameters** to change dates, capital, or costs.
3. Check the dates and capital shown at the top.
4. Select **Run backtest**.
5. Wait until the results area and logs show that this run has completed.

When **Run backtest** becomes available again, the current settings differ from the last completed run. The metrics still belong to the previous run until the new run finishes.

## Leave after editing

The numbered areas show:

1. The current dates and capital summary.
2. The **Run backtest** button.
3. The confirmation shown when changes have not been run.

![Historical Chinese UI example: Confirmation shown when leaving a strategy with changes that have not been run](/docs/images/help/zh/backtesting/edit-rerun-01.png)

If **Unsaved changes** appears when you select New or another strategy:

- To keep the changes, select **Cancel**, then run the backtest.
- If the changes are not needed, select **Discard changes**.

Discarding removes code or parameter changes that have not been run. It does not alter the previously completed result.

Selecting a historical report changes the displayed result, not the editor or run settings. To return to old rules, inspect that report's saved configuration and deliberately update the current draft. Selecting an old report does not undo edits.

## Compare results before and after a change

Record at least:

- The code or rule that changed.
- Start and end dates.
- Initial capital.
- Base slippage and impact coefficient.
- Fill count, total return, and maximum drawdown.

Change one main setting at a time when possible. If rules, dates, and costs all change together, the result difference cannot be attributed to just one of them.

## Before refreshing

Changes that have not been run may also be lost when the page is refreshed or closed. If the browser asks whether to leave, stay on the page and run the backtest unless you are certain the changes are not needed.

## Migrate the old account API

The strategy SDK now groups operations by account. The old flat API is removed. Saved source and frozen deployments are not rewritten automatically. Historical reports remain viewable. Migrate source before rerunning a backtest, scan, or signal generation; create a new deployment from a backtest of the migrated strategy.

| Old call | New call |
| --- | --- |
| `ctx.value` | `ctx.portfolio.equity` for reporting; `ctx.stock.equity` for stock sizing |
| `ctx.cash` / `ctx.availableCash` | Choose `ctx.stock.availableCash` or `ctx.futures.availableCash`; funding is isolated |
| `ctx.order(code, shares)` | `ctx.stock.orderAdjustedShares(code, shares)` in adjusted shares |
| `ctx.orderLots(code, lots)` | `ctx.stock.orderLots(code, lots)`, 100 real shares per lot |
| `ctx.setHoldings(weights)` | `ctx.stock.setTargetWeights(weights)` |
| `ctx.orderTargetPercent(code, weight)` | `ctx.stock.setTargetWeight(code, weight)` |
| `ctx.positions()` / `ctx.shares(code)` | `ctx.stock.positions()` / `ctx.stock.adjustedShares(code)` |
| `ctx.exit(code)` | `ctx.stock.closePosition(code)` |
| `ctx.orderFuture(code, contracts)` | `ctx.futures.orderContracts(code, contracts)` |
| `ctx.setFutureTargetContracts` / `ctx.setFutureTargetNotional` | `ctx.futures.setTargetContracts` / `ctx.futures.setTargetNotional` |
| `ctx.hedgeFuture` / `ctx.exitFuture` / `ctx.futurePosition` | `ctx.futures.hedgeStock` / `ctx.futures.closePosition` / `ctx.futures.position` |
| `ctx.equalWeight` / `ctx.atrUnits` / `ctx.volTargetWeights` | `ctx.stock.equalWeight` / `ctx.stock.atrAdjustedShares` / `ctx.stock.volTargetWeights` |
| `ctx.stopLoss` / `ctx.limitBuy` | `ctx.stock.stopLossAtAdjustedPrice` / `ctx.stock.limitBuyAtAdjustedPrice` |
| `ctx.trailingStop` / `ctx.takeProfit` / `ctx.cancelConditional` | `ctx.stock.trailingStopByFraction` / `ctx.stock.takeProfitByFraction` / `ctx.stock.cancelConditional` |

Deltas accumulate within a decision; later targets replace earlier targets. Stock target books cover the entire account and liquidate omitted holdings, so they cannot mix with stock deltas. Futures conflicts are checked per code. `closePosition` replaces earlier ordinary orders for its code and rejects subsequent deltas. Suspensions, price limits, and sellable quantities still constrain closure. Persistent conditions follow their existing independent rules.

Python uses snake_case names such as `ctx.stock.order_adjusted_shares`, `set_target_weights`, `set_target_weight`, and `close_position`, with `ctx.portfolio.equity`, `ctx.stock.equity`, and `ctx.stock.available_cash`. Python continues to support stocks and ETFs only; this change adds no futures trading. See the [SDK reference](/sdk).

## Related articles

- [Set backtest parameters](/help/backtesting/run-settings)
- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Inspect backtest results](/help/backtesting/results-overview)

