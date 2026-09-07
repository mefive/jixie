# Research company valuation with the FCFF template

The “FCFF company valuation template” on the Research landing page creates a Markdown/Python
document that can be inspected, edited, clean-run, and promoted. It starts with Wuliangye as a real
example, but its example inputs are not platform forecasts, price targets, or trading advice.

## What the template separates

The document keeps three kinds of information distinct:

- historical facts: statement versions available on the valuation date, revenue, NOPAT, ROIC,
  reinvestment, FCFF, market capitalization, and shares;
- user assumptions: revenue growth, NOPAT margin, incremental capital turnover, WACC, perpetual
  growth, terminal ROIC, and equity-bridge adjustments;
- market-implied assumptions: one revenue-growth rate solved from current enterprise value while all
  other base-case inputs remain fixed.

The formulas are documented openly. Repeated calculations use `valuation.fcff_scenarios` and
`valuation.implied_revenue_growth`; inputs, bridge adjustments, and sensitivity remain editable in
Python Cells. The helpers do not forecast. Editing parameters marks dependent results stale.

## Workflow

1. Open Research and select “Open template” under “FCFF company valuation template.”
2. Review the stock, valuation date, review date, forecast length, and three scenarios in the first
   Python Cell.
3. Review required operating cash, other non-operating assets, and other senior claims. The platform
   does not guess them.
4. Select “Clean run all.”
5. Inspect history, assumptions, three valuations, sensitivity, reverse valuation, and the next-report
   review.
6. To retain the evidence, open the successful run under “Complete run history” and promote it.

Reassess model applicability after changing the stock. Banks, insurers, and brokers are not passed
through the industrial-company FCFF model.

## Forecast and terminal value

The forecast uses the visible relationship:

```text
Revenue
  × NOPAT margin
  = NOPAT
  - Revenue increase / incremental capital turnover
  = FCFF
```

The perpetual-growth terminal value expresses the terminal reinvestment rate as terminal growth
divided by terminal ROIC. A scenario is rejected when terminal growth is at least WACC, terminal ROIC
cannot support growth, or shares are non-positive. A visible warning is emitted when terminal value
exceeds the explicit share-of-enterprise-value threshold.

The equity bridge starts from the M2 financial kernel's difference between enterprise value and market
capitalization, then applies explicit required operating cash, other non-operating assets, and senior
claims. These subjective adjustments remain in the parameter Cell.

## Reading scenarios and reverse valuation

The downside, base, and upside outputs form a scenario range, not a statistical confidence interval.
Every cell in the sensitivity heatmap reruns the same DCF with a declared WACC and terminal-growth
pair.

Reverse valuation partitions the declared growth interval at stationary points of the valuation
function before solving each segment, checking nearby roots and tangent roots. It returns an implied
growth rate only when there is one identifiable root. No solution, multiple solutions, non-finite
values, and weak identification produce diagnostics. The result is one price interpretation under
fixed assumptions, not the market's unique narrative.

## Reusing calculations and checking applicability

Use these methods directly in Research Python Cells. See the [Research SDK reference](/docs/sdk) for
all parameters and return columns:

```python
forecasts = valuation.fcff_scenarios(base, scenarios, bridge, forecast_years=5)
implied = valuation.implied_revenue_growth(
    base, scenarios[scenarios["scenario"] == "base"], bridge,
    target_enterprise_value=market_enterprise_value,
)
```

`base` contains one row with `revenue` and `nopat_margin`. `scenarios` declares each scenario name,
revenue growth, target NOPAT margin, incremental capital turnover, WACC, terminal growth, and terminal
ROIC. `bridge` contains one row with `bridge_adjustment`, `issued_shares`, and `operating_cash_required`.
Amounts use CNY, shares use shares, and ratios use decimals (`0.08` means 8%).

The bridge adjustment already includes required operating cash. The helper deducts `bridge_adjustment`
from enterprise value without adding operating cash again. Revenue compounds at constant growth and
margin converges linearly. Declining revenue assumes capital can be released; this may be inappropriate
for capital-intensive businesses and needs review. Limits are 20 scenarios and 20 forecast years.
Outputs have one row per scenario and year; summary valuations repeat and must not be summed across
years. Results include `formula_version`; terminal-value share is null when enterprise value is zero.

The same workflow has been exercised on Wuliangye, Midea, and CATL. They share calculation rules, not
growth or discount-rate assumptions. Unavailable historical FCFF or reinvestment keeps its missing
reason in the review rather than becoming zero; missing required operating inputs or bridge values
stop execution.

Main-business segments are not in the public SDK: samples lack announcement/version timestamps, and
hierarchies, renaming, and missing cost/profit fields require reconciliation. Do not sum every segment
row or infer volume and price separately from revenue changes. There is currently no dedicated
industry-driver template or company price-target page.

## Reviewing the next report

The Wuliangye example compares the scenarios recorded on `2025-04-28` with the 2025 annual report as
available on `2026-05-06`. The review keeps:

- the original downside, base, and upside range;
- actual revenue, NOPAT margin, FCFF, and revenue growth from the next annual report;
- whether the actual result remained inside the declared range;
- the new market-implied revenue growth on the review date.

The initial and review datasets use separate `as_of` dates, so the later annual report is not leaked
back into the initial valuation.

## Accounting flags and unavailable metrics

Source statement versions are never rewritten to fix an anomaly. Calculations inspect the versions
actually selected at the historical date. Metrics depending on unexplained negative cash capital
expenditure, an unreconciled balance sheet, or inconsistent cross-statement net income return null,
`status=invalid`, and `missing_reason=accounting_review_required:…`. This means the current model
cannot safely use them; it does not assert that the company's disclosure is wrong.

The restriction follows actual input versions, including TTM quarters and prior-year balances.
Unrelated metrics remain available. A negative non-current liability subtotal that reconciles to total
liabilities produces a warning only. Beginning/ending cash discrepancies do not automatically invalidate
operating cash flow, which does not depend on those balances. Do not fill unavailable values with zero,
ignore their status, or silently switch to an older report to produce a valuation.

## Related pages


- [Research data catalog](/docs/help/research/data-catalog)
- [Build a research document with Cells](/docs/help/research/document-cells)
- [Research documents and run history](/docs/help/research/records)
