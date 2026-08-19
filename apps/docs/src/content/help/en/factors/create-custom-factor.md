# Create and edit a custom factor

A custom factor converts each stock's data on each comparison date into a number. You can describe the calculation to the Agent on the left or edit the code directly in the middle.

## Before you start

Define the calculation first:

- Which field does it use?
- What does a higher value mean?
- What should happen when the value is missing or cannot be calculated?

This article uses book-to-market as the example. The product provides price-to-book as `pb`, so:

$$
\text{Book-to-market}=\frac{1}{\text{Price-to-book}}
$$

No derivation is needed here. Calculate the reciprocal only when price-to-book is present and greater than zero; otherwise return no value.

## Open a new factor

If Research already has a promoted successful version with one explicit point-in-time signal, you can create the draft from
that snapshot instead. An LLM rewrites the free-form study into constrained Factor SDK code, and the Factor compiler rejects
invalid definitions. A source card on the left shows the originating research version, distilled summary, and remaining
checks; its icon opens the exact source snapshot. You must still review the code and complete FactorReport, holdout, cost, and
capacity validation.

1. Open **Factor Research**.
2. Select **New** on the left.
3. Choose the research method, enter a display name, and choose the unique key that cannot change after creation.
4. After creating it, enter the calculation request at the bottom left or edit the code directly.

The numbered areas are:

1. **New**.
2. The newly created and autosaved Factor.
3. Prompt input for the Agent.
4. Factor code editor.
5. **Run analysis**.

![The new custom-factor page](/docs/images/help/zh/factors/factor-custom-new-01.png)

For an Agent request, describe the actual rule. For example:

> Create a book-to-market factor. Return one divided by price-to-book when price-to-book is greater than zero; otherwise return no value.

Read the generated code line by line. It is code awaiting your review, not evidence that the factor is valid.

## Edit the code directly

A runnable factor contains at least a name and a `compute` function:

```ts
export default defineFactor({
  name: 'Book-to-market (custom)',
  compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null),
});
```

In this code:

- `name` is the label shown in the page.
- `compute` calculates the value for the current stock and date.
- `bar.pb` is price-to-book.
- A missing, zero, or negative price-to-book returns `null`, so that stock has no valid factor value for the period.

The numbered areas are:

1. Current custom-factor name.
2. Input for further Agent revisions.
3. Current code.
4. Run an analysis with the current code.

![Edited book-to-market factor code](/docs/images/help/zh/factors/factor-custom-edited-01.png)

Do not return `0` merely to give every stock a value. Zero is a real number and participates in ranking. `null` means that no usable value exists for that period.

## Use financial history fields

Custom factors can read announcement-aligned ROE and gross-profit-margin history. `grossprofitMargin` uses percentage points: `35` means a 35% margin, not `0.35`.

Financial history follows point-in-time rules. On date $t$, only the latest report announced on or before $t$ is available. Earlier dates do not see a future report, and dates before the first available report return `null`. The history is a step series that changes on announcement dates, not a newly calculated financial statement every day.

For gross-margin stability, state the window and missing-data rule first. For example, calculate dispersion from valid values over the latest 504 trading days and return `null` when coverage is insufficient. Never backfill historical dates with the latest margin visible today.

## Run an analysis and save the current code

1. Check the frequency, date range, and neutralization setting at the top right.
2. Select **Run analysis**.
3. Choose **Exploratory** in the pre-run research card, or record a hypothesis before the run.
4. Select **Freeze research card and run**.
5. Wait for the methodology, grouped returns, and metrics on the right.

The Factor is persisted when the creation dialog is confirmed, and draft edits autosave. Analysis waits for the current code to save; after completion, refresh the page and confirm that the name, key, code, and report remain available.

You can also ask the Agent to run exploratory analysis for one explicit candidate. It creates the same immutable report but cannot start or reveal a formal holdout. See [Ask the factor Agent to run exploratory analysis](/docs/help/factors/agent-explore-analysis).

The numbered areas are:

1. Saved custom factor.
2. Frequency, dates, and setting summary.
3. Methodology and reproducibility details.
4. Run log.

![A completed analysis for the custom factor](/docs/images/help/zh/factors/factor-custom-analysis-01.png)

The historical-data notice in the screenshot belongs to this report. If historical states such as negative net assets or long suspensions cannot be handled reliably, read the report's explicit warning instead of assuming that current status was filled back into the past.

## Verify a revision

Run a new analysis after changing the code. An older report still describes the older code.

Check in this order:

1. The name and formula agree.
2. Missing and invalid inputs return `null` as intended.
3. The meaning of high and low values is clear.
4. The log contains no calculation errors.
5. Grouped returns, Rank IC, turnover, and sample size are plausible.

One historical analysis does not establish causality or guarantee future returns.

## Common questions

### The run reports a code error

Inspect the middle log. Common causes include an incorrect field name, a missing bracket, or a calculation that returns neither a number nor `null`. Correct the code and run again.

### Too few stocks have a value

Check whether the field exists in the selected date range and whether the condition is too restrictive. Do not fill an unavailable value with an arbitrary number.

### The right panel still shows the old result

Reports do not recalculate automatically. Run a new analysis after editing the code.

### Do I need to review Agent-generated code?

Yes. Verify fields, direction, missing-value treatment, and units, then use a real analysis to confirm that the code runs.

## Related articles

- [Set the analysis range and sample treatment](/docs/help/factors/analysis-settings)
- [Read your first factor analysis result](/docs/help/factors/results-overview)
- [Set a Factor key](/docs/help/factors/strategy-key)
- [Ask the factor Agent to run exploratory analysis](/docs/help/factors/agent-explore-analysis)
