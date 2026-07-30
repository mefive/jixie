# Report history and outdated results

Each factor analysis creates a separate report. Report history keeps the factor code, analysis settings, status, and result used at that time, so you can reopen and compare them later.

It is not a temporary cache of the latest result. Running the same settings again after the previous report finishes creates another record instead of replacing the old one.

## Open report history

1. Find **History** at the upper right of the factor page.
2. Open the report list.
3. Find the creation time and settings you need.
4. Select the record. The page restores that report's settings and result.

A report can have one of these statuses:

- **Running**: computation is still in progress. You can refresh and return through the same record.
- **Done**: the result is available.
- **Failed**: computation did not finish, but the failed record remains.
- **Interrupted**: the original task cannot continue after a restart or abnormal exit. You can run the same settings again.

Records are also labeled Explore, Holdout · sealed, Holdout · revealed, or Historical. A holdout is a reserved period that was not used to adjust the factor. See [Formal holdout and out-of-sample results](/help/factors/holdout-results).

The numbered areas below are:

1. A completed formal holdout whose result is still sealed.
2. The explore report that produced it.

![Explore and sealed holdout reports in report history](/docs/images/help/zh/factors/factor-holdout-history-01.png)

The date range, neutralization setting, and Rank IC in the list help identify a report. Open it and verify the full methodology before comparing results.

## What opening a historical report restores

The page restores the saved analysis settings, including:

- Monthly or weekly frequency.
- Start and end dates.
- No neutralization, size neutralization, or size and industry neutralization.
- Versioned universe, missing-data, outlier, and cost settings.
- The factor-code snapshot used for that run.

The code SHA-256 shown in a report is a content fingerprint. Different fingerprints mean the calculation code was different.

A historical report preserves its saved inputs and output, but a complete market-data revision identifier is not yet connected. Do not assume that a later recomputation must reproduce every digit after underlying market data is corrected.

## Why the page says the report uses old settings

If you change analysis settings without running again, the page continues to show the old report and displays a yellow warning.

The numbered areas below are:

1. The current draft now uses size neutralization.
2. **Run again** will create a report from the new draft.
3. The warning says that the visible result still comes from the old settings.

![An existing report marked outdated after settings change](/docs/images/help/zh/factors/factor-report-outdated-01.png)

“Outdated” does not mean the historical report is invalid or deleted. It means:

> The current editor or analysis settings no longer match the report on screen.

You can:

1. Keep the change and select **Run again** to create a new report.
2. Discard the change by reopening the current historical report.
3. Run the new settings, then compare both records from history.

Editing custom factor code produces the same type of warning. The old report keeps its code snapshot and does not disappear when the editor changes.

## Compare two reports correctly

Confirm that only the intended item changed. When comparing neutralization, for example, keep these inputs the same:

- Factor code.
- Frequency and date range.
- Universe and sample treatment.
- Trading costs.
- Expected direction and primary criterion in the research card.

Then compare decile ordering, Rank IC, ICIR, turnover, net-of-cost results, and maximum drawdown. A single higher number is not meaningful if several inputs also changed.

Repeating the same settings adds reports but may not add research variants. See [Pre-run research cards and variants](/help/factors/research-card).

## Things to know

- Report history is a research record, not a trading recommendation.
- Failed and interrupted records do not become successful reports automatically.
- There is no action for deleting one individual report.
- Running again adds a report instead of overwriting the selected record.
- Dates and figures in an old report can differ from the latest report.

## Related articles

- [Size and industry neutralization](/help/factors/neutralization)
- [Pre-run research cards and variants](/help/factors/research-card)
- [Formal holdout and out-of-sample results](/help/factors/holdout-results)
