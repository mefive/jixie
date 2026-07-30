# Generate today's signals

After deployment, the Today page can use the latest completed trading-day close to generate instructions for the next trading day.

## Open a deployed strategy

1. Select **Today** in the top navigation.
2. Select a strategy on the left.
3. Check its name, deployment date, code version, and Active status.
4. Confirm that the page says it uses the frozen deployed version.

Before the first signal run:

1. Deployed strategy list.
2. Strategy, deployment date, and code version.
3. **Generate now**.
4. No-run state.

![A deployed strategy before its first signal run](/docs/images/help/zh/signals/signal-empty-01.png)

**Never generated** does not mean deployment failed. It means the deployment has no signal-run record yet.

## Generate now

1. Confirm that the latest trading session has closed.
2. Select **Generate now**.
3. Wait for the loading state to finish.
4. Read the run log.
5. Wait for the signal date, execution date, and result.

Generation uses the frozen deployment and does not read an unrun editor draft in the Backtest workspace.

A normal log shows:

- Close date and execution date.
- Backtest dates and initial cash.
- Run progress.
- Final model equity.
- Number of generated instructions.

## Signal date and execution date

- Signal date: the session whose close data the strategy reads.
- Execution date: the next trading day after the signal date.

For example, a signal generated from the 2026-07-28 close has an execution date of 2026-07-29. Do not treat a pre-close result as complete or the execution date as guaranteed fill.

## No action today

When the run completes without a required position change, the page displays **No action today**:

1. Completed run log.
2. Signal date, execution date, model equity, and notification state.
3. No-action result.
4. Reference-price note.
5. History with zero instructions.

![A successful run with no action today](/docs/images/help/zh/signals/signal-no-action-01.png)

No action is a complete result, not a blank page or error. The frozen strategy and that day's data require no change to target holdings.

## Market data is not ready

If the page says data for a date is not ready:

1. Confirm that the trading session has closed.
2. Wait for market-data processing.
3. Select **Refresh**.
4. Try **Generate now** again.

Do not submit repeatedly. Refresh reloads state but cannot create market data before processing completes.

## Scheduled and manual runs

A deployed strategy can run through the daily post-close process. **Generate now** is useful when the day has not run, a retry is needed, or the workflow is being checked. Repeating a successfully completed deployment and signal date returns the durable result; it does not create a different strategy.

## Common questions

### Generation remains in progress

Read the log, then refresh. If a service restart interrupted the task, the page identifies it as interrupted and the run can be retried.

### The page reports a failure

Read the red error and the log. Possible causes include market data not ready, a paused deployment, or a strategy runtime error.

### Why was no email sent?

Check **Email notification**. Development explicitly skips delivery. Production delivery failure is displayed separately; always inspect the page result as well.

## Related articles

- [Deploy a backtested strategy](/docs/help/signals/deploy-strategy)
- [Read signal instructions](/docs/help/signals/read-signals)
- [View history and pause a deployment](/docs/help/signals/history-pause)
