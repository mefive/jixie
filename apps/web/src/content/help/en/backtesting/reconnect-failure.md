# Reconnect to a run and handle failures

You can refresh while a backtest is running. When the same strategy opens again, the page checks for its running job and resumes displaying status and logs.

## Reconnect after a refresh

1. Confirm that the strategy has been submitted.
2. Refresh, or reopen the same strategy.
3. Wait for its name and code to load.
4. Check that the results area reports a running backtest.
5. Check whether logs continue to update.
6. Wait for this job to finish; do not submit the same run again.

The numbered areas show the page after a refresh:

1. The current strategy name.
2. The restored running status.
3. The log area continuing to show progress.

![A running backtest reconnected after the page was refreshed](/help/zh/backtesting/reconnect-01.png)

It is normal to see only a startup message briefly. Confirm completion from the final metrics, charts, and completion log.

## If nothing changes for a long time

Check in this order:

1. Whether new log lines are appearing.
2. Whether the Run button is still in its running state.
3. Whether the same strategy reopened after the refresh.
4. Whether the date range is long or the strategy processes many instruments.

When reporting a problem, record the strategy name, date range, refresh time, and final log line. Do not repeatedly submit the same backtest.

## Failed runs

The results area displays an error for a failed job. The numbered areas show:

1. The strategy code used by the run.
2. The failure message.
3. The log area.

![A backtest failure caused by strategy code that cannot compile](/help/zh/backtesting/failure-01.png)

To handle a failure:

1. Read the first error in the results area.
2. Check the final log lines before the failure.
3. Check that the code is complete and that brackets and quotation marks are paired.
4. Check the instrument, dates, capital, and parameters.
5. Correct the problem and run again.
6. Verify that the completed result uses the latest settings.

## Common causes

- **Compilation failure**: incomplete code, missing symbols, or unsupported syntax.
- **Missing data**: an incorrect instrument or insufficient history in the date range.
- **Invalid parameters**: dates, capital, quantity, or strategy parameters are not valid.
- **Excessive runtime**: a long range, many instruments, or repeated daily calculations.

A failure is not a negative investment return. It means this run did not produce a usable result, so an older result on the page must not be used in its place.

## Related articles

- [Run a backtest and inspect logs](/help/backtesting/run-and-logs)
- [Edit a strategy and run it again](/help/backtesting/edit-rerun)
- [Inspect backtest results](/help/backtesting/results-overview)

