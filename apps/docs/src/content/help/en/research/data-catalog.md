# Use the research data catalog

The **Data catalog** shows the instruments, measures, and calls supported by the current research runtime. Do not guess field names from memory. Confirm them in the catalog, then insert the generated code into a Python Cell.

## Search and insert

1. Open a research document.
2. Select the data icon in the upper-right corner to open **Data catalog**.
3. Search by instrument name, code, or measure, such as CSI 300, `000300.SH`, or close.
4. Select a data item and check its description, unit, frequency, and returned columns.
5. Set any date, frequency, or transform controls offered by the page.
6. Insert the call into the current Python Cell.

After insertion, verify that the instrument, dates, and variable name match your research question.

## Three data shapes

### One instrument over time

Use `data.series()` for a time series of one supported index, stock, or other instrument.

```python
monthly = data.series(
    "index", "000300.SH",
    start="20200101", end="20251231",
    frequency="monthly", transform="simple_return",
)
```

The result includes `date` and `value`. Treat the current catalog signature as authoritative for parameters and columns.

### One point-in-time stock cross-section

Use `data.cross_section()` for China A-share fields available at a historical trading date. It is suitable for exploratory distributions, relationships, and universes, but does not replace a formal FactorReport.

### Completed month-end stock Panels

Use `data.panel()` for point-in-time cross-sections over completed month-ends. It supports exploratory multi-period sorting, regression, and stability checks. Specify dates, universe, fields, and missing-value rules. Never backfill today's latest financial value into past dates.

## Point-in-time and revision boundaries

- Cross-sections and Panels use information available at the time; financial fields align to announcement dates.
- Historical membership, names, and industries use historical records where supported.
- A rerun may read later data revisions. Use a clean full run to preserve an immutable result.
- Ad hoc IC, sorts, or regressions are exploratory. Validate a candidate signal again through FactorReport.

## Use editor assistance

Type `data.`, a dot after a variable, or function arguments to see current methods, parameters, and returned columns. A red underline normally means a method, argument, or column does not match the current SDK. Check assistance and the catalog before suppressing it.

![Research SDK column completion](/docs/images/help/zh/research/data-catalog-01.png)

## Common questions

### The data I need is not listed

Search by instrument code or a common measure name. If it is still absent, the current catalog does not provide it. Do not let the Agent silently substitute a similar dataset.

### The result is empty

Check the instrument code, dates, frequency, and the field's first available date. For a cross-section, also verify that the requested date resolves to a supported trading day.

## Related articles

- [Read and rerun a Universe result](/docs/help/research/universe)
- [Read research outputs](/docs/help/research/outputs)

