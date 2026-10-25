# Run your first preset factor analysis

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Use the default settings for a first analysis. The aim is to learn the workflow, without making a trading decision from one result.

## Open the preset

1. Sign in and select **Factor Research** in the top navigation.
2. Select **Factor library** on the left.
3. Under **Preset factors**, select **Earnings yield (1/PE_TTM)**.
4. Confirm that the row is selected.
5. Wait for the read-only preset notice in the middle and the dates and **Run analysis** action on the right.

![Select the earnings-yield preset](/docs/images/help/en/factors/factor-workspace-01.png)

The middle code shows how the preset is calculated. You do not need to edit it for the first run. Use **Copy as custom** later if you need a modified version.

If the factor has previous reports, the latest one appears on the right. A factor that has never been run shows the prompt to set the frequency and dates and then run the analysis.

## Submit an analysis

1. Check dates, frequency and neutralization; monthly observations without neutralization are a suitable first comparison.
2. Select **Run analysis** to submit directly.
3. Wait for completion, then inspect the actual sample, data definitions and results.

## Wait for completion

After submission, the page displays **Running** and a computing message. The numbered areas are:

1. Analysis summary, retained reports, and run status.
2. Computation status.
3. Run logs.

![Historical Chinese UI example: A factor analysis in progress](/docs/images/help/zh/factors/factor-running-01.png)

While it is running:

1. Do not submit the same run repeatedly.
2. Use the middle log area to inspect rebalance dates, data loading, and computation progress.
3. You may refresh the page; the workbench restores the current task.
4. Wait for the methodology card, group chart, and metrics to appear on the right.

The latest submitted analysis remains available; another run replaces an older ordinary report. After changing dates, frequency, neutralization, or another setting, run the analysis again before reading the result as if it reflects that change.

## If the run does not complete

### It remains in progress

Refresh the page and reopen Earnings yield. The page reconnects to a task that is still running. Do not submit a duplicate while the original task is active.

### The page reports a failure

Inspect the log and the error on the right. Confirm that the date range contains enough data and that settings such as minimum candidates are not too restrictive. Correct the setting and run again.

### The run action is missing

Select a factor from the Factor library first.

## Related articles

- [What factor research can answer](/help/factors/what-factor-research)
- [Set the analysis range and sample treatment](/help/factors/analysis-settings)
- [Read your first factor analysis result](/help/factors/results-overview)
