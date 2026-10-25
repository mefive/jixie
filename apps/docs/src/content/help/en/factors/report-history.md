# Retained reports and outdated results

Each factor retains your latest submitted analysis. Published or archived versions also retain their publication-bound report. Queued and running tasks remain until completion. An identical active analysis reuses its task; completed analyses can be rerun.

A new analysis replaces an older ordinary result, including when the new run fails. Removed report links and Python `results.factor_report(report_id)` return a report-not-found error; associated jobs and logs are removed too. To retain a version and its result, publish it after a successful analysis.

## Open a report

1. Select a factor in the workbench.
2. The latest analysis opens by default. When multiple reports remain, use **Retained reports** to switch; the **Publication report** tag identifies the version’s fixed report.
3. Check dates, frequency, analysis kind, source and data cutoff.
4. Inspect results and logs. Save the page address to reopen a report while it remains retained.

Reports are private to their owner. Completed results can be read directly without a reveal step.

## Handle outdated results

Editing code or settings does not recalculate an old report. When the page marks results as outdated, run again with the current settings or restore the report's saved settings. Compare published versions using consistent data definitions, costs and samples, and record unfavorable findings too.

## Ask about a report

Attach an owned completed report to a question, or ask about the definition only. The Agent receives a summary; use [embedded analysis](/docs/help/research/embedded-analysis) for additional calculations. Missing information must be stated explicitly, and an explanation is not a new factor test.

![Historical Chinese UI example: Changed code or settings require a rerun](/docs/images/help/zh/factors/factor-report-outdated-01.png)

![Report questions](/docs/images/help/en/factors/report-question.png)

## Publish a version

Publication fixes the current code and a matching successful report. Published versions cannot be edited; copy one to a new draft to make changes. Existing strategies keep their original version key. See [Publish a factor version](/docs/help/factors/publish-factor).
