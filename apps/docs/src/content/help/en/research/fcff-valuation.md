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

The formulas remain in ordinary Python Cells instead of a hidden valuation engine. Editing the
parameter Cell marks dependent results stale.

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

Reverse valuation scans the declared revenue-growth bounds before solving. It returns an implied
growth rate only when there is one identifiable root. No solution, multiple solutions, non-finite
values, and weak identification produce diagnostics. The result is one price interpretation under
fixed assumptions, not the market's unique narrative.

## Reviewing the next report

The Wuliangye example compares the scenarios recorded on `2025-04-28` with the 2025 annual report as
available on `2026-05-06`. The review keeps:

- the original downside, base, and upside range;
- actual revenue, NOPAT margin, FCFF, and revenue growth from the next annual report;
- whether the actual result remained inside the declared range;
- the new market-implied revenue growth on the review date.

The initial and review datasets use separate `as_of` dates, so the later annual report is not leaked
back into the initial valuation.

## Related pages

- [Research data catalog](/docs/help/research/data-catalog)
- [Build a research document with Cells](/docs/help/research/document-cells)
- [Research documents and run history](/docs/help/research/records)
