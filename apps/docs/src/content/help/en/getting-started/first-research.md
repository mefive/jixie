# Complete your first quantitative study

Research keeps questions, formulas, Python calculations, tables, and charts in one reproducible document. You can write
Python yourself or ask the Research Agent to generate and explain it; SQL and TypeScript are not required.

## Start a study

1. Open **Research** from the top navigation.
2. Choose the complete example or create a blank study.
3. Use a Markdown cell for the question, prespecified hypothesis, formula, variable definitions, and limitations.
4. Use a Python cell to load platform data through `data.series()`, calculate with pandas / SciPy / statsmodels, and draw
   with `charts.*` or Matplotlib.
5. Run one cell, its affected branch, or the full document in a clean runtime. A complete run creates an immutable snapshot
   that can be reviewed and promoted later.

When a promoted successful version contains one explicit point-in-time signal supported by platform data, you can create a
Factor draft from the snapshot. An LLM first checks semantic convertibility, then the Factor compiler validates the generated
code. If conversion is not possible, the product explains why. The Factor keeps the source snapshot, distilled summary, and
remaining validation items, with a link back to the exact snapshot. This creates a draft only: it does not prove efficacy, run
a report, reveal a holdout, or publish the Factor.

When the research also defines instruments or a point-in-time universe, signal direction, rebalance or entry/exit conditions,
and a sizing rule, the same snapshot can create a Python Strategy draft. The draft defaults to `py-v1` and opens in Strategy
Lab with its source, summary, and unresolved items. It does not run automatically: review the rule, set the backtest range,
capital, and costs, then run it explicitly. A study that contains only a predictive relationship is routed to Factor first
instead of bypassing formal validation through Strategy.

Factor definitions still use the TypeScript SDK/runtime; Python Factor support remains in the backlog. Research → Factor
therefore generates TypeScript for now, while Research → Strategy defaults to Python.

The Agent can add methods and formulas, edit Markdown/Python cells, and explain real outputs. It cannot claim that unexecuted
code has run or replace code and output with prose. When data or methods are unavailable, it reports the exact gap.

## Study an equity universe

You can also describe cross-sectional conditions, for example, “Find A-shares with P/E TTM below 20 at the latest available date, sorted by total market cap.” The saved UniverseSpec freezes:

- data and historical-membership dates;
- listing age, suspension, and risk-warning handling;
- measure versions, units, missing values, filters, and sorting;
- data revision and eligibility-stage counts.

Select an object in the table to open its unified detail page. Reopen the research record to rerun the same spec deterministically.

> Statistical association and matching conditions are not trading advice. Verify definitions, temporal direction, sample, and limitations.

[Open Research](/research)
