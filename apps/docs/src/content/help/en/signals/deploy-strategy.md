# Deploy a backtest report

Deployment turns a successful backtest report into an independent operating instance. Later strategy edits and backtests do not change an existing deployment.

## Select and deploy a report

1. Open the strategy in the Lab and select the intended report from backtest history. Historical reports can also be deployed.
2. Inspect that report’s results and report information. The current editor draft may differ from a historical report.
3. Select **Deploy**. After success, the action becomes **Pause**.
4. Open **Daily signals** and check the source report, deployment ID, date, and status. Follow the report link to return to that report.

Deployment supports successful TypeScript stock/ETF reports with results. Python and futures are not supported. Referenced Factors must meet publication requirements and match the report’s lineage. Missing or changed evidence requires a new backtest report.

## Reports, drafts, and deployments

- Editing a draft does not change its reports or deployments and does not label a deployed report as outdated.
- Two reports with identical code and settings can operate simultaneously, with separate signals and accounts.
- A report has at most one active deployment. Repeated requests return that deployment.
- Deploying another report does not pause any other deployment. Select the intended instance in **Daily signals** and choose **Pause deployment**, or select its source report in the Lab and choose **Pause**.
- Deploying a paused report again creates a new deployment and account baseline; previous signals and accounts remain available.

## Common questions

### Can I deploy while the draft has unrun edits?

Yes. You can deploy a successful report using its frozen settings. To deploy the edited content, run a new backtest and select the new report.

### Why is Deploy disabled?

Select a successful TypeScript report and wait for it to load. The API also checks supported assets and Factor publication requirements.

### Why does a legacy deployment have no linked report?

Older data did not reliably record its source report. The system retains the frozen configuration and status without guessing from matching code. Legacy instances can still be viewed, run, and paused.

### Can I delete the strategy after deploying it?

Strategies with deployment history cannot be deleted, including paused deployments. This preserves source reports, signals, and accounts.

Deployment does not connect to a broker, place orders, or guarantee daily trading instructions.

## Related articles

- [Generate today’s signals](/docs/help/signals/generate-signals)
- [View history and pause a deployment](/docs/help/signals/history-pause)
- [Read signal instructions](/docs/help/signals/read-signals)
