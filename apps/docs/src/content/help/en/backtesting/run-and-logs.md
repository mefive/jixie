# Run a backtest and inspect logs

After checking the settings, select **Run backtest** once. Do not repeatedly submit the same strategy; use the page status and logs to follow its progress.

## Start the run

Before selecting Run:

1. Confirm that the correct strategy is open.
2. Check the instruments, directions, quantities, and frequency in the code.
3. Check the displayed dates and capital.
4. Check the cost settings.
5. Select **Run backtest** once.

## While the backtest is running

The numbered areas show a submitted job:

1. **Run backtest** enters its running state and cannot be selected again.
2. The results area says that the backtest is running.
3. Logs begin showing startup and processing progress.

![Running state, results notice, and live logs](/docs/images/help/zh/backtesting/run-logs-01.png)

Runtime depends on the date range, number of instruments, strategy calculations, and data volume. A results area without metrics does not by itself mean the run failed.

## Read the logs

Logs contain:

- **System progress**: startup, data loading, completion, or failure.
- **Strategy output**: content written through `console.log` in the strategy.

Use logs to check whether a rule fired on expected dates. A monthly strategy can log rebalance dates, but avoid writing repetitive output for every trading day.

## Confirm completion

The run is complete when:

- Metrics appear under **Overview**.
- The equity and drawdown charts can be displayed.
- **Trades (count)** appears when fills exist.
- The final log line reports completion.

The completed result is saved with the strategy and can be reopened from History.

## Refresh or reopen

If you refresh while a run is in progress or reopen the same strategy, the page attempts to reconnect to the running job. Check the logs and final status before submitting another run.

If the page remains in a running state for a long time:

1. Check whether new log lines are appearing.
2. Allow the current job to finish.
3. Refresh and reopen the same strategy.
4. If it still does not change, record the strategy name, date range, and last log line.

## Failed runs

Do not use an older result on the page to evaluate the latest change. Read the error and logs first. Common causes include:

- Code that does not compile.
- An instrument or period without required data.
- Invalid capital or parameters.
- A strategy that takes too long to execute.

Run again after correcting the problem, then verify that the new result matches the new code and settings.

## Related articles

- [Inspect backtest results](/help/backtesting/results-overview)
- [Set backtest parameters](/help/backtesting/run-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)

