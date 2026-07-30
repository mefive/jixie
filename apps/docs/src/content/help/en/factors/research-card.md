# Pre-run research cards and variants

A research card asks you to record what an analysis is intended to test before seeing its result. It cannot make a conclusion correct, but it separates a prior expectation from an explanation invented after looking at the data.

The card opens whenever you select **Run analysis** or **Run again**.

## Test a hypothesis or explore

The card has two modes:

- **Test a hypothesis**: you already have a specific question and can record a direction and primary criterion before the run.
- **Pure exploration**: you do not yet know what to expect. The report is explicitly recorded as exploratory and cannot later be presented as a pre-registered hypothesis.

Pure exploration is suitable when first learning the page. Use hypothesis mode when making a deliberate factor comparison.

## Fill in a hypothesis research card

The example below uses earnings yield. The numbered areas are:

1. Select **Test a hypothesis**.
2. Write a statement that historical data can check.
3. Record the economic or behavioral rationale.
4. Select the expected direction, primary metric, comparison operator, and threshold.
5. Freeze the card and run.

![A hypothesis research card for earnings yield](/docs/images/help/zh/factors/factor-research-hypothesis-01.png)

### Hypothesis

State which factor characteristic is expected to relate to which subsequent return.

Example:

> Stocks with higher earnings yield tend to rank higher in next-month returns than stocks with lower earnings yield.

Avoid statements such as “this factor works” or “returns will be good.” They do not specify a direction, comparison, or horizon.

### Economic or behavioral rationale

Explain why the relationship might exist. For example:

> Lower-valued companies may earn higher subsequent returns, but the relationship should also be checked after removing size and industry exposure.

The rationale is optional but useful. A strong historical number does not replace a review of data and plausible explanations.

### Expected direction

- **Expected positive**: higher factor values are expected to have higher subsequent return ranks.
- **Expected negative**: higher factor values are expected to have lower subsequent return ranks.

Choose the direction from the factor definition and hypothesis, not after seeing the result.

### Primary criterion

The page can freeze one primary metric:

- **Mean Rank IC**, for example `> 0.02`.
- **Annualized ICIR**, for example `> 0.5`.
- **Net long-short annualized return**. Enter a decimal, so `0.05` means 5%.

There is no universal threshold for every factor. The criterion only fixes the first check in advance. It does not replace decile monotonicity, IC stability, turnover, costs, neutralization, or out-of-sample evidence.

## When the card is frozen

Selecting **Freeze research card and run** saves the card with the report. The old report's card cannot be edited.

A later run can start from the previous card and change its wording, direction, or criterion, but it belongs to a new report. Changing code, parameters, direction, or primary criterion may also create a new research variant.

## Read the variant count

After a report finishes, the research bar appears below the settings bar. The numbered areas are:

1. Frequency, date range, and neutralization of the current report.
2. Explore variants, completed reports, and the random false-positive reminder.
3. **Validate holdout** for an eligible explore report.
4. The current report's sample range.

![Research variant count and the holdout action](/docs/images/help/zh/factors/factor-research-summary-01.png)

### Reports and variants are different

- **Completed reports** count successful explore reports.
- **Explore variants** are distinct research choices after deduplicating the same code, settings, and structured criterion.

Repeating the same code, settings, and primary criterion usually remains one variant but creates another report. Failed, interrupted, and formal holdout reports are excluded from the explore-variant count.

### Random false-positive reminder

The page shows a simple reminder at the 5% level:

$$
\text{Expected random false positives}
=
\text{Explore variants}\times 5\%
$$

For 17 distinct variants:

$$
17\times 5\%=0.85
$$

If none of the tests had a real relationship, this simplified level would imply about 0.85 apparently significant results in expectation.

This is not a completed statistical correction, and it does not say that exactly 0.85 factors are wrong. It reminds you that more attempts create more opportunities for an attractive result to appear by chance.

## Common mistakes

- Describing pure exploration as a prior expectation after seeing the result.
- Repeatedly changing a threshold until the current report passes.
- Keeping only successful reports and ignoring failures or opposite results.
- Treating one met criterion as approval to trade.
- Testing many similar factors without checking correlation and common exposure.

The card creates an honest record. It is not a certification label.

## Related articles

- [Report history and outdated results](/help/factors/report-history)
- [Formal holdout and out-of-sample results](/help/factors/holdout-results)
- [Factor correlation matrix](/help/factors/correlation-matrix)
