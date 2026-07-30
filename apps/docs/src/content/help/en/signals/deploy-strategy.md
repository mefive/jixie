# Deploy a backtested strategy

Deployment freezes the strategy version that has already been run so the Today page can generate close-based signals. Unrun editor drafts do not go live automatically.

## Before you start

The strategy must:

- Have completed a backtest successfully.
- Have no unrun code or parameter changes.
- Have no backtest currently running.
- Use supported stocks or ETFs. Index-futures daily signals are not currently supported.

**Deploy live** remains unavailable before the first result or after an unrun edit.

## Deploy the current result

1. Open the strategy in the Backtest workspace.
2. Confirm that the displayed result is the version you intend to deploy.
3. Check the dates, initial cash, and code.
4. Select **Deploy live**.
5. Wait for the action to change to **Pause live**.

The numbered areas are:

1. Current strategy.
2. Run-parameter summary.
3. **Deploy live**.
4. Current backtest result.

![A backtested strategy ready for deployment](/docs/images/help/zh/signals/signal-deploy-ready-01.png)

After deployment:

1. The top still shows the frozen run parameters.
2. The action changes to **Pause live**.
3. The result remains visible.

![A strategy after deployment](/docs/images/help/zh/signals/signal-deploy-active-01.png)

Deployment freezes the code, start and end dates, initial cash, and trading-cost settings. Today signals use this version and do not read subsequent unrun text from the editor.

## Edit after deployment

When the editor contains an unrun change:

1. **Run backtest** becomes available again.
2. The old frozen version remains active.
3. The deployment action identifies the old version that must be paused.

![An unrun edit after deployment](/docs/images/help/zh/signals/signal-deploy-outdated-01.png)

To deploy the revision:

1. Pause the old version.
2. Run a backtest with the current code.
3. Inspect the new result.
4. Deploy again.

Do not assume that an editor change has altered the live version. The page keeps drafts, results, and deployments separate.

## Where to go next

Select **Today** in the top navigation. The deployed strategy appears on the left; its deployment date, code version, and **Generate now** action appear on the right.

Deployment does not send orders to a broker and does not guarantee an instruction every day. It establishes a fixed strategy version that can run on close data.

## Common questions

### Deploy live is disabled

Complete a backtest first. After changing code, dates, cash, or costs, run again so the displayed result matches the current settings.

### Why does the page identify an old live version after editing?

The deployed version is frozen. The old version remains active until it is paused and a completed revision is deployed.

### Can I delete a deployed strategy?

Pause it first and confirm that its signal history is no longer needed. Do not remove a strategy that still has an active deployment.

### Why can an index-futures strategy not be deployed?

Today signals currently support stock and ETF instructions, not index futures. Futures results remain available in the Backtest workspace.

## Related articles

- [Generate today's signals](/docs/help/signals/generate-signals)
- [Read signal instructions](/docs/help/signals/read-signals)
- [Set backtest run parameters](/docs/help/backtesting/run-settings)
