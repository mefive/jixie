# View history and pause a deployment

Run history shows whether each day completed and how many instructions it produced. Pausing stops that deployment from generating future signals without deleting its existing history.

## View run history

1. Open **Today**.
2. Select the strategy on the left.
3. Scroll to **Run history**.
4. Check the signal date, status, and instruction count.

The numbered areas are:

1. Current deployment and latest date.
2. Current run summary.
3. History for two signal dates.

![History containing an action and a no-action day](/docs/images/help/zh/signals/signal-history-01.png)

Possible states are:

- Done: strategy and signal calculation completed.
- Generating: the task has not finished.
- Failed: the task ended without a valid result.
- Interrupted: a restart or another interruption prevented normal completion.

Zero instructions can be a normal completed result. Read it together with the status and No action today.

## Refresh and retry

### Generating

Select **Refresh** first. If it still shows generating, inspect the log and do not click Generate now repeatedly.

### Interrupted

The page asks you to generate again. Confirm that market data is ready, then retry.

### Failed

Read the page error and log. Correct the market-data, strategy-runtime, or deployment-state problem before retrying.

A successful result for a deployment and signal date is stored durably. Refreshing or signing in again does not remove it.

## Pause the deployment

1. Return to the Backtest workspace.
2. Open the strategy.
3. Select **Pause live**.
4. Wait for the action to become **Deploy live** again.

After pausing:

1. Current run parameters.
2. Deployment is available again.
3. The backtest result remains.

![A strategy after pausing its deployment](/docs/images/help/zh/signals/signal-pause-01.png)

After a pause:

- The deployment no longer participates in future daily signal runs.
- Existing signals and backtest results do not become real fills.
- History remains available for checking past runs.
- To deploy a revision, run the new version first and then create a new deployment.

## When to pause

- The strategy is no longer being used.
- Its code, parameters, or data definition needs correction.
- The live account cannot follow the model assumptions.
- A newly backtested version must replace it.
- Signals appear abnormal and future runs should stop during investigation.

Pausing is not deletion and does not reverse any action already taken in a live account. The user must handle live-account changes separately.

## Notification state

Each result also records email status:

- Sent: delivery completed.
- Failed: signal calculation may have succeeded, but email delivery failed.
- Skipped in development: local or test environments deliberately did not send.

Do not rely on email alone. Open Today regularly and check page status and history.

## Common questions

### Is history still visible after pausing?

Yes. A pause changes future run state and does not delete existing run records.

### How do I resume after a pause?

Open the strategy, confirm that the current code and parameters have a completed result, and deploy again. This creates a new frozen deployment.

### Why can a modified strategy not resume immediately?

Deployment must correspond to a completed backtest. Run the revision, inspect its result, and then deploy.

## Related articles

- [Deploy a backtested strategy](/docs/help/signals/deploy-strategy)
- [Generate today's signals](/docs/help/signals/generate-signals)
- [Read signal instructions](/docs/help/signals/read-signals)
