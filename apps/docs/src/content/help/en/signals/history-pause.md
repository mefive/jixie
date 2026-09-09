# View history and pause a deployment

Daily signals stores history per deployment. The same strategy name may represent different reports or repeated deployments of one report; use the source report and deployment ID to distinguish them.

## View history

1. Select an instance on the left. Both active and paused deployments are listed.
2. Choose a signal date in **Run history** and inspect its status, instructions, and Factor inputs.
3. Review that deployment’s model, simulation, and actual account curves. Recording fills affects only this deployment.

A completed run with zero instructions can be valid. Running, Failed, and Interrupted describe unfinished, failed, and interrupted attempts. Refreshing does not erase history.

## Pause a deployment

Select the intended instance in **Daily signals** and choose **Pause deployment**. Alternatively, follow its source report to the Lab and choose **Pause** for that report.

Pausing blocks new signals for this deployment and does not affect other instances. Queued jobs may finish, existing accounts continue to settle, and historical fills can still be recorded. A pause does not cancel broker orders or reverse actual fills. **Generate now** is disabled for paused deployments.

## Deploy again

Select a successful report in the Lab and choose **Deploy**. Deploying a previously paused report creates a new deployment and account baseline; earlier signals and accounts remain available. Deploying a new report also leaves other active instances running.

Legacy instances without a linked report can be paused directly in **Daily signals**. Select a successful report to create a new report-bound deployment.

## Notification state

Each run records email delivery as sent, failed, or skipped in development. A delivery failure does not imply a calculation failure; check the run status and logs.

## Related articles

- [Deploy a backtest report](/docs/help/signals/deploy-strategy)
- [Generate today’s signals](/docs/help/signals/generate-signals)
- [Read signal instructions](/docs/help/signals/read-signals)
