# Use the research data catalog

The **Data catalog** shows the instruments, measures, and calls supported by the current research runtime. Do not guess field names from memory. Confirm them in the catalog, then insert the generated code into a Python Cell.

Use [selected financial fields](/docs/help/research/financial-data) for batch queries with annual, quarterly, TTM, or reported values.

## Search and insert

1. Open a research document.
2. Select the data icon in the upper-right corner to open **Data catalog**.
3. Choose **Market data**, **Datasets**, **Factor reports**, or **Backtests** to find instrument series, dedicated datasets, or completed reports you can read.
4. Search by name, code, or keyword, such as CSI 300, `000300.SH`, or `10Y`.
5. Select an item and check its local coverage, dates, and returned columns.
6. Insert the call into the current Python Cell.

After insertion, verify that the instrument, dates, and variable name match your research question.

## Common data-access patterns

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

ETFs use the same entry point. For example, `data.series("etf", "510300.SH", ...)` returns adjusted closes inside that product's local coverage. The catalog also shows registry exposure, primary or backup role, coverage dates, and proxy limitations. A product from the full ETF directory is marked available only when local daily history actually exists; the runtime does not silently substitute another ETF for the same index.

### One point-in-time stock cross-section

Use `data.cross_section()` for China A-share fields available at a historical trading date. It is suitable for exploratory distributions, relationships, and universes, but does not replace a formal FactorReport.
In **Datasets**, select China A-shares, CSI 300, CSI 500, or CSI 1000 and choose the cross-section date to insert a complete call.

### Completed month-end stock Panels

Use `data.panel()` for point-in-time cross-sections over completed month-ends. It supports exploratory multi-period sorting, regression, and stability checks. Specify dates, universe, fields, and missing-value rules. Never backfill today's latest financial value into past dates.
The catalog shows only the date range jointly supported by local price, valuation, and historical membership data.

### Versioned statements and standardized financial metrics

Fundamental research provides original statements, selected fields, metrics, cross-sections, and Panels without SQL. See [Analyze financial data](/docs/help/research/financial-data) for batch field queries and period bases. The original four entry points remain available:

```python
statements = data.equity_financial_statements("000858.SZ", as_of="20240429")
metrics = data.equity_financial_metrics("000858.SZ", as_of="20240429")
cross_section = data.equity_financial_cross_section(
    "index:000300.SH",
    date="20240429",
    metrics=["revenue", "returnOnInvestedCapital"],
)
panel = data.equity_financial_panel(
    "index:000300.SH",
    start="20200101",
    end="20241231",
    frequency="month_end",
    metrics=["revenueGrowthYoY", "returnOnInvestedCapital"],
)
```

The single-equity statement method returns a `period × statement × field` long table with announcement date, research
availability date, version quality, and source fingerprint. The single-equity metric method returns all standardized M2
metrics. Cross-sections and Panels accept at most eight metrics and return at most 50,000 and 100,000 rows respectively;
they use batch database reads instead of per-equity queries.

Interpret metric rows through `value`, `unit`, `status`, and `missing_reason`, while retaining `formula_version` and
`input_versions_json`. A ratio of 1 means 100%. Missing quarters, fields, and invalid denominators never become zero.
Banks and non-bank financial companies remain `not_applicable` for industrial metrics. Statement access is separate: financial-sector sources are not integrated, so statements return an empty frame when no integrated records exist. The selected-field batch method returns an explicit source-not-integrated reason.

### Chinese and US yield curves

Use `data.yield_curve()` for US Treasury nominal and real yields, plus the catalog's Ministry of Finance government, ChinaBond government, and AAA credit curve tenors. Curves, tenors, and transforms have a separate allowlist; do not guess a yield table or field through `data.series()`. See [Load US Treasury yield curves](/docs/help/research/yield-curves) for parameters, percentage-point units, and US/China time-zone boundaries.
**Datasets** lists only curve and tenor combinations that actually exist locally.

## More dedicated datasets

Search by name under **Datasets** and check local coverage. These have dedicated methods; they cannot all be replaced with `data.series()`:

| Data | Research SDK method | Definition to check |
| --- | --- | --- |
| Macro and short-term rates | `data.macro()` | Units, availability, and revision limits; Shibor is not a bond yield curve |
| FX | `data.fx()` | Pair direction and availability for CNY research; FX return is not asset return |
| Commodity continuous returns, warehouse receipts, member holdings | `data.commodity_returns()`, `data.commodity_warehouse_receipts()`, `data.commodity_holdings()` | Product coverage and roll decomposition; ranked-member holdings are not whole-market holdings |
| Market and industry states | `data.market_state()`, `data.industry_state()` | Universe, historical constituents, and descriptive scope, not a prediction |
| Equity provider ratios, flows, and dividends | `data.equity_fundamentals()`, `data.equity_flows()`, `data.equity_dividends()` | Provider definitions differ from versioned financial statements; dividends are implemented cash distributions selected by ex-dividend date |
| ETF shares and index valuation | `data.etf_shares()`, `data.index_valuation()` | Observation date, units, source, and local coverage |
| Futures settlement reference | `data.futures_settlement()` | Settlement, fees, and margin for an actual delivery contract; continuous symbols are not accepted |

See the [Research SDK reference](/docs/sdk?runtime=research) for signatures, enums, and columns. Queryable data does not imply trading backtests or daily deployment for that market.

## Read existing reports and observations

- Select your completed visible report under **Factor reports** to insert `results.factor_report()`. This does not unseal an unrevealed Holdout.
- Select a report under **Backtests** to insert `results.backtest_report()` and read frozen settings, equity, trades, and factor lineage without rerunning the strategy.
- Use `results.strategy_scan_report()` with a stable scan report ID to read per-combination metrics.
- Use `results.factor_weather()` for a pinned factor to read stored monthly observations without triggering a refresh.

Report IDs, strategy IDs, and Factor keys are different identifiers. In Factor/Strategy conversations, **Reference data** reuses this catalog but saves only the source selection for the question. Inspect the [embedded analysis run](/docs/help/research/embedded-analysis) to verify actual data requests.

## Point-in-time and revision boundaries

- Cross-sections and Panels use information available at the time. Dedicated financial methods select versions by
  `available_date` and exclude `reconstructed` versions whose historical availability cannot be proven.
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
For an ETF, also check its listing date and local coverage start in the catalog. Do not automatically replace it with another ETF that tracks the same index.

## Embedded analysis in chat

For a bounded calculation on an existing report or selected data, use an [embedded analysis card](/docs/help/research/embedded-analysis). It retains Python, inputs and outputs, fixes a version on first success, and can continue in Research. That copy defaults to replaying the retained inputs; ordinary document history rules remain unchanged.

## Related articles

- [Read and rerun a Universe result](/docs/help/research/universe)
- [Load US Treasury yield curves](/docs/help/research/yield-curves)
- [Use the Research Python runtime](/docs/help/research/python-runtime)
- [Read research outputs](/docs/help/research/outputs)
