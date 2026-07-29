# Run your first preset factor analysis

This article runs **Earnings yield (1/PE_TTM)** with the default settings and an exploratory research card. The purpose is to learn the workflow, not to make a trading decision from one result.

## Open the preset

1. Sign in and select **Factor Research** in the top navigation.
2. Select **Factor library** on the left.
3. Under **Preset factors**, select **Earnings yield (1/PE_TTM)**.
4. Confirm that the row is selected.
5. Wait for the read-only preset notice in the middle and the dates and **Run analysis** action on the right.

![Select the earnings-yield preset](/help/zh/factors/factor-workspace-01.png)

The middle code shows how the preset is calculated. You do not need to edit it for the first run. Use **Copy as custom** later if you need a modified version.

If the factor has previous reports, the latest one appears on the right. A factor that has never been run shows the prompt to set the frequency and dates and then run the analysis.

## Submit the first analysis

1. Check the summary at the top. For the first run, use monthly frequency and no neutralization.
2. Select **Run analysis**.
3. In the pre-run research card, select **Exploratory**.
4. Read the notice that an exploratory result cannot later be presented as a pre-registered hypothesis.
5. Select **Freeze research card and run**.

![Select exploratory mode in the pre-run research card](/help/zh/factors/factor-research-card-01.png)

Exploratory mode is appropriate for your first look at a factor. Hypothesis mode asks you to write the hypothesis, expected direction, and criterion before seeing the result.

## Wait for completion

After submission, the page displays **Running** and a computing message. The numbered areas are:

1. Analysis summary, report history, and run status.
2. Computation status.
3. Run logs.

![A factor analysis in progress](/help/zh/factors/factor-running-01.png)

While it is running:

1. Do not submit the same run repeatedly.
2. Use the middle log area to inspect rebalance dates, data loading, and computation progress.
3. You may refresh the page. The report is already available through **Report history**.
4. Wait for the methodology card, group chart, and metrics to appear on the right.

The completed report remains in **Report history**. After changing dates, frequency, neutralization, or another setting, run the analysis again before reading the result as if it reflects that change.

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
