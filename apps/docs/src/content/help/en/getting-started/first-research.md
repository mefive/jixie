# Complete your first quantitative study

Research keeps questions, formulas, Python calculations, tables, and charts in one reactive document. You can write Python
yourself or ask the Research Agent to select data, generate code, and explain real output; SQL and TypeScript are not required.

## Start a study

1. Open **Research** from the top navigation.
2. Enter the question you want to test and submit it. Research creates a document and passes the question to the Research Agent.
3. Review and refine the question, prespecified hypothesis, formula, variable definitions, and limitations in the Markdown cell.
4. Use `data.series()` in a Python cell for one object's time series, or `data.cross_section()` / `data.panel()` for PIT equity
   snapshots and month-end panels. Calculations may use pandas, NumPy, SciPy, and statsmodels.
5. Use `charts.*` for native interactive charts or Matplotlib for static figures.
6. Run one cell, its affected branch, or the full document in a clean runtime. A complete run creates an immutable
   `ResearchExecution` that can be reviewed in the document history and explicitly promoted to a named research version.

Document-level autosave protects cell source and shows unsaved, saving, or saved state. Editing upstream source marks dependent
outputs stale; expensive calculations do not rerun silently in the background.

## Work with the Research Agent

The Agent can add statistical methods and formulas, query the exact Research SDK contract, edit Markdown/Python cells, and
explain real output. Its changes enter inline cell review: previous lines remain read-only while Agent-added or modified content
can still be edited. Accept keeps the user's final edited version, and Undo restores the pre-review document. A proposal never
runs a cell by itself.

The Agent cannot claim that unexecuted code has run or replace code and output with prose. If an exact object, dataset, SDK
method, or analysis capability is unavailable, it must report that gap instead of silently substituting similar data.

When an explicitly different executable proxy exists, the Agent first asks you to confirm the research definition. Ordinary
input and Cell proposals pause until you answer. The answer persists across refresh, but confirmation does not make a proxy
equivalent to the original object.

## Send research to formal validation

When a promoted successful version contains one explicit point-in-time signal supported by platform data, it can create a
Python Factor draft. An LLM first checks semantic convertibility, then the Factor compiler and `py-v1` runtime validate the
code. The Factor retains its exact source snapshot, distilled summary, unresolved items, and backlink. Supported universe,
date, frequency, filter, and prespecified-direction choices become suggested FactorReport parameters. The user must confirm
them and run the report explicitly; the handoff does not reveal the holdout, publish the Factor, or turn exploratory findings
into formal evidence.

When the research also defines instruments or a point-in-time universe, signal direction, rebalance or entry/exit conditions,
and a sizing rule, the same snapshot can create a Python Strategy draft. The draft defaults to `py-v1` and never runs a backtest
automatically. Review its code, range, capital, and costs in Strategy Lab before running it. Research that contains only a
predictive relationship is routed to Factor first.

## Study an equity universe

You can also describe cross-sectional conditions, for example, “Find A-shares with P/E TTM below 20 at the latest available
date, sorted by total market cap.” The saved UniverseSpec freezes:

- data and historical-membership dates;
- listing age, suspension, and risk-warning handling;
- measure versions, units, missing values, filters, and sorting;
- data revision and eligibility-stage counts.

Select an object in the table to open its unified detail page. A rerun uses the same spec and currently available data; an
upstream revision changes the disclosed data revision.

> Statistical association and matching conditions are not trading advice. Verify definitions, temporal direction, sample,
> robustness, and implementation constraints.

[Open Research](/research)

## Continue learning

- [Build a research document with Cells](/docs/help/research/document-cells)
- [Use the research data catalog](/docs/help/research/data-catalog)
- [Collaborate with Research Agent](/docs/help/research/agent-collaboration)
- [Answer a research-definition clarification](/docs/help/research/clarifications)
- [Load US Treasury yield curves](/docs/help/research/yield-curves)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
