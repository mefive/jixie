# Edit a strategy and run it again

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

![Confirmation shown when leaving a strategy with changes that have not been run](/docs/images/help/zh/backtesting/edit-rerun-01.png)

If **Unsaved changes** appears when you select New or another strategy:

- To keep the changes, select **Cancel**, then run the backtest.
- If the changes are not needed, select **Discard changes**.

Discarding removes code or parameter changes that have not been run. It does not alter the previously completed result.

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

## Related articles

- [Set backtest parameters](/help/backtesting/run-settings)
- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Inspect backtest results](/help/backtesting/results-overview)

