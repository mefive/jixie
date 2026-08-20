# Read research outputs

The final expression or an explicit display call in a Python Cell appears below that Cell. An output can be text, a number, a table, a native interactive chart, or a static Matplotlib figure. Before interpreting it, verify that it comes from current source rather than a stale result.

## Text and numbers

Scalars, lists, and short text render directly. Include a name, unit, and sample size with important values so the document does not preserve an unexplained number.

## Tables

A pandas DataFrame renders as a paginated table. The page limits the number of rows shown at once and truncates oversized cells to keep large results responsive.

The top notice below identifies the source rows, preview rows, and truncated cells. Pagination and page size controls appear at the bottom.

![Research table pagination and truncation notices](/docs/images/help/zh/research/outputs-01.png)

Preview truncation changes only the display; it does not mean the calculation produced only those rows. Before citing a large table, summarize, filter, or sample it in code and record that choice in Markdown.

## Native interactive charts

`charts.*` produces product-native interactive charts with tooltips, zooming, and legend interactions. Available forms include histograms, boxplots, heatmaps, and event paths.

```python
charts.histogram(
    monthly_returns,
    column="return",
    bins=8,
    labels={"return": "Monthly return"},
    title="Monthly return distribution",
)
```

![Native interactive charts in a research document](/docs/images/help/zh/research/outputs-02.png)

A chart only presents the supplied data. Binning, axis range, missing values, and sample dates affect its interpretation; state them in adjacent Markdown.

## Static Matplotlib figures

Use Matplotlib when you need a custom figure not covered by native charts. Static figures do not provide native tooltips or zooming. Keep their dimensions, label count, and resolution bounded.

## Outputs and snapshots

- A single-Cell or affected-branch run updates exploratory output in the current document.
- A successful clean full run preserves its output in an immutable execution.
- Historical snapshot source and output are read-only and are not overwritten by later edits.
- A chart or table alone does not validate a method; review it with the source, input scope, and hypothesis.

## Common questions

### The chart did not appear

First confirm that the Cell succeeded. Then check the column names and data types passed to `charts.*`. An empty table cannot produce a meaningful chart.

### The table shows only part of the result

That is the preview bound. Page through it, or use Python to filter and aggregate the rows relevant to the question.

## Related articles

- [Use the research data catalog](/docs/help/research/data-catalog)
- [Research documents and run history](/docs/help/research/records)

