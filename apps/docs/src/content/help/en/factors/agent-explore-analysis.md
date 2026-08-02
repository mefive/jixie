# Ask the factor Agent to run exploratory analysis

While editing a custom factor, you can ask the Agent to analyze the current code or one explicit candidate. It freezes the research card and settings before reading compact Rank IC, net long-short, and turnover evidence.

This capability is restricted to exploration. It cannot start or reveal a formal holdout for the user.

## State the request clearly

Include at least:

- The factor hypothesis.
- Expected direction.
- Primary criterion.
- Monthly or weekly frequency.
- Start and end dates.
- Neutralization choice.

For example:

> The hypothesis is that more stable profitability predicts higher subsequent returns. Use monthly observations from 2020-01-01 through 2024-12-31 with size and industry neutralization. The primary criterion is a positive mean Rank IC. Run one exploratory analysis and explain coverage, IC, turnover, and net results.

If there is no directional hypothesis, explicitly call it exploratory. Do not rewrite an exploratory report as a prior hypothesis after seeing a favorable result.

## What is saved

An Agent-started run creates a real immutable factor report containing:

- The complete custom-factor or candidate code.
- Research card.
- Dates, frequency, and neutralization.
- Universe, missing-data, outlier, and cost settings.
- Data cutoff and job state.
- The complete report after calculation.

The conversation reads compact metrics, but the complete report can be reopened from report history. Cancelling the conversation does not corrupt a report job that has already been created; it may finish independently.

## What the Agent cannot do

It cannot:

- Cross the sealed exploratory boundary.
- Start or reveal a formal holdout.
- Finalize the factor as approved.
- Deploy a strategy.
- Present one exploratory result as proof of future validity.

A turn should normally compare no more than one or two materially different candidates to limit mechanical tuning against one sample.

## Review the completed analysis

1. Open the Agent-created report from report history.
2. Verify the frozen code and research card.
3. Check common sample, missing data, and data cutoff.
4. Read Rank IC, decile returns, turnover, net results, and drawdown.
5. If the Agent also proposed new code, confirm which candidate the report represents.
6. Record a reason for another variant before running it.

Do not copy one IC number from the reply without the full report's sample, cost, and consistency context.

## Difference from manual Run analysis

Both entry points use the same reports and research discipline:

- A manual run asks the user to complete the research card in the page.
- An Agent run submits the candidate, card, and settings from the conversation and reads a compact result afterward.

Reports remain immutable regardless of the entry point.

## Related articles

- [Create and edit a custom factor](/docs/help/factors/create-custom-factor)
- [Pre-run research cards and variants](/docs/help/factors/research-card)
- [Report history and outdated results](/docs/help/factors/report-history)
- [Formal holdout and out-of-sample results](/docs/help/factors/holdout-results)
