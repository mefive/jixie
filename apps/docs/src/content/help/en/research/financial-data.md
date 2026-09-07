# Analyze financial data

Research supplies data and reproducible calculations. You choose the question, fields, formulas, and interpretation.
FCFF is an optional template. Comparing revenue, assets, or cash flow requires neither a valuation model nor a profitable strategy.

## Start in the data catalog

1. Open a research document, open the data catalog, and select Datasets.
2. Search for “Selected financial fields” and select “Selected financial fields and period basis”.
3. Enter equity codes, separated by commas for multiple companies.
4. Choose fields, reporting-period range, period basis, and historical availability cutoff.
5. Review the Python preview, insert it into a Cell, and run it. Both the query and subsequent calculations are editable.

Fields use explicit `statement_kind.field` names, such as `income.revenue` and `balance_sheet.totalAssets`. The [Research SDK reference](/docs/sdk?runtime=research#data.equity_financial_values) and editor completion list the available fields.

## Two separate dates

`report_start` and `report_end` select reporting-period ends inclusively. `as_of` selects versions available on or before that historical cutoff, including every prerequisite used in a calculation.

Viewing 2023–2025 reports from May 2026 can include revisions known by May 2026. This is not what an investor knew in 2023.
Use `data.equity_financial_panel()` for metrics available at each historical month-end. An explicit stock list does not reconstruct historical index membership.

```python
financial_values = data.equity_financial_values(
    ["000858.SZ", "600519.SH"],
    as_of="20260506",
    fields=["income.revenue", "balance_sheet.totalAssets"],
    report_start="20230101",
    report_end="20251231",
    period="annual",
)
financial_values
```

## Period bases

| period | Revenue, cost, and cash-flow fields | Assets, liabilities, and beginning/ending cash stocks |
|---|---|---|
| `reported` | Reported year-to-date value | Reported observation |
| `annual` | December annual reports only | December report observations only |
| `quarterly` | Q1 as reported; later quarters difference adjacent YTD values | Reported observation |
| `ttm` | Full-year value at year-end; otherwise four continuous quarters | Reported observation, without averaging |

Stock fields have `period_basis=point_in_time`. Beginning cash remains the beginning of the original YTD report, not the beginning of each quarter.
Prerequisite reports are loaded before filtering the output range. Missing quarters are not zero-filled or replaced by another basis.

Each request allows at most 100 identifiers, 16 fields, 20 reporting calendar years, and 100000 rows. Output is a code-by-field-by-reporting-period long table, including missing observations.

## Statements and predefined metrics

`data.equity_financial_statements()` retains original fields, announcement dates, availability quality, and source fingerprints. Filters are optional:

```python
statements = data.equity_financial_statements(
    "000858.SZ", as_of="20260506",
    fields=["income.revenue", "cash_flow.nCashflowAct"],
    report_start="20230101", report_end="20251231",
)
```

Omitting the three filters preserves existing calls. The returned `field` is still an unqualified name such as `revenue`; interpret it together with `statement_kind`.

`data.equity_financial_metrics()` supplies 32 predefined metrics and their formulas. You can use them or calculate your own from statement fields.
Legacy `data.equity_fundamentals()` reads provider-calculated indicators without equivalent historical-version and formula lineage. Its `_pct` fields use percentages; do not mix them with new metric ratios (`ratio=1` means 100%).

## Missing data and applicability

Read `value`, `unit`, `period_basis`, `status`, and `missing_reason`; preserve `formula`, `formula_version`, and `input_versions_json`.
`available_date` is the latest availability among this row's calculation inputs. If inputs are missing, this does not establish completeness.

`status=ok` means a value was retrieved and converted as requested. It is not an audit result or valuation-model approval. Negative source values remain visible; predefined metrics retain their separate accounting checks.

Only mapped industrial-company A-share fields are integrated. Financial-sector sources are not integrated: the batch method returns `financial_sector_source_not_integrated`, while the original statement method returns an empty frame when no integrated statements exist. Industrial-model metrics remain `not_applicable` for financial companies.

Strict historical queries exclude `reconstructed` versions, but this does not establish that every original historical filing vintage exists. Notes, business segments, and analyst consensus are not available through this interface.
