# Publish a Factor and use it in a strategy

Publication locks a researched Factor into an immutable definition that strategies can reference. It is not merely saving a draft, and it does not prove future performance.

## Check before publishing

Confirm that the selected report belongs to the Factor, completed successfully, and matches the current code and settings. Verify the key, research card, holdout, primary criterion, data cutoff, scope, direction, and cost assumptions.

If code or settings changed, the page marks the report as outdated. Run a new report before publication.

## Publish

1. Open the report you intend to approve.
2. Scroll to Publication and strategy reference.
3. Verify the report reference and code hash.
4. Click Publish.
5. Check the Factor key in the confirmation dialog and confirm.

The numbered areas are:

1. Publication status and explanation.
2. Report reference and code hash.
3. Publish action.

![Publication and strategy reference in a Factor report](/docs/images/help/zh/factors/publish-factor-01.png)

## What becomes immutable

After publication, the Factor name, key, code, research type, and approved report cannot change. A strategy freezes the Factor ID, key, code hash, and approved report so historical runs remain traceable.

Use Copy to create an independent draft when the definition must change. The suggested `_v2` or `_v3` key is new; publication status, approved reports, and strategy references are not inherited.

## Continue to Strategy Lab

1. Click Use in Strategy Lab.
2. Wait for the backtest workspace.
3. Verify the prefilled key, research assets, and rebalance rule.
4. Run the backtest.
5. Check Factors used by this backtest for the frozen Factor ID and code hash.

![Published status, Strategy Lab action, and frozen lineage](/docs/images/help/zh/factors/publish-factor-02.png)

The research long-short diagnostic is not the strategy return. A strategy also includes actual holdings, cash, fills, costs, and rebalance rules.

## Archive

A published Factor cannot be deleted. Archiving removes it from new strategy completion while preserving historical backtests and deployments.

## Related articles

- [Set a Factor key](/docs/help/factors/strategy-key)
- [Holdout and out-of-sample results](/docs/help/factors/holdout-results)
- [Use a custom factor in a strategy](/docs/help/factors/factor-in-strategy)
