# Read a factor-composite report

A composite uses the pipeline for its selected research method. Verify frozen components and the common cross-section before reading stock deciles or Panel rankings, turnover, and net results.

## Open the report

1. Select a factor composite in the library.
2. Select **Run analysis**.
3. Complete the research card before seeing metrics.
4. Wait for the report to finish.
5. Reopen the immutable result later from report history.

The numbered areas show:

1. The composite definition used for this run.
2. The sample and direction summary.
3. Frozen methodology, component count, standardization, and common universe.
4. Rank IC, return, drawdown, and turnover metrics.

![A completed factor-composite analysis report](/docs/images/help/zh/factors/factor-composite-report-01.png)

## Verify the methodology first

The methodology card should show:

- Specification version.
- Component names and count.
- Positive or negative direction for each component.
- Rank or Z-score standardization.
- Equal weighting.
- Component coverage and final common-universe size.
- Universe, neutralization, outlier, cost, and data-cutoff settings.

If the common universe is much smaller than the single-factor samples, check whether one component has poor coverage. A sample change can alter returns and IC by itself, so do not attribute every difference to a better combination.

## Compare with component Factors

Keep frequency, dates, universe, neutralization, and costs identical. Compare at least:

- Mean Rank IC for the composite and every component.
- Positive-IC rate and ICIR.
- Top-group turnover.
- Gross and net long-short return.
- Maximum drawdown.
- Valid stock count.

If a higher return also comes with materially higher turnover, drawdown, or sample loss, retain those qualifications.

## Editing does not overwrite history

Every report stores the composite definition and code snapshot of every component. Later edits do not change old reports; another run creates another report.

Use report history to compare variants rather than relying on the currently edited definition.

## Holdout remains a user decision

An exploratory composite does not automatically start or reveal a holdout. Consider one formal holdout only when the hypothesis, direction, and primary criterion were recorded before exploration and the definition has not been repeatedly tuned.

The Agent cannot start or reveal a holdout, or deploy the composite as a strategy.

A Panel report also requires class-level evidence and each ETF's listing coverage. Its Top/Bottom diagnostic portfolio is not the executed long-only ETF strategy in Strategy Lab.

## Misuses to avoid

- Do not treat low correlation as proof of diversification.
- Do not repeatedly add or remove components against one exploratory sample.
- Do not retain only the best-performing definition.
- Do not treat a research composite as a live strategy with sizing and execution rules.

## Related articles

- [Create and edit a factor composite](/docs/help/factors/create-composite)
- [Formal holdout and out-of-sample results](/docs/help/factors/holdout-results)
- [Turnover, trading costs, and net returns](/docs/help/factors/turnover-costs)
- [Run cross-asset Panel research](/docs/help/factors/panel-research)
- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
