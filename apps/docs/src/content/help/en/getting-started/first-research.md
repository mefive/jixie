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
6. Run one cell, its affected branch, or the full document in a clean runtime. Inspect current output in the document; edit and rerun when needed.

Document-level autosave protects cell source and shows unsaved, saving, or saved state. Editing upstream source marks dependent
outputs stale; expensive calculations do not rerun silently in the background.

## Choose data and a starting point

Open **Data catalog** to select an instrument, dates, frequency, and fields and insert an SDK call without memorizing method names. For company research, start with [Analyze financial data](/docs/help/research/financial-data). Then write the analysis in ordinary Cells.

If you already created an [embedded analysis](/docs/help/research/embedded-analysis) in a Factor or Strategy conversation, select **Continue in Research** when its task ends. The copy contains current code and parameters and fetches current data when run.

Manage studies in the **Current** and **Archived** lists, with search over titles or recent content. See [Research documents and run history](/docs/help/research/records) for archive, restore, and permanent deletion.

## Read an existing FactorReport

Copy a report ID from the current Factor result or a retained report link, then load it read-only in a Python cell. Reruns remove older ordinary reports; publication-bound reports remain:

```python
factor_report = results.factor_report("report ID")
rank_ic_mean = factor_report["report"]["ic_mean"]
```

Report and parameter fields use snake_case. This method neither changes nor reruns a report. Only owned completed reports can be read.

## Work with the Research Agent

The Agent can add statistical methods and formulas, query the exact Research SDK contract, edit Markdown/Python cells, and
explain real output. Its changes are saved as pending proposals without modifying Cells. Open the message card's read-only diff and explicitly accept to save them. Closing keeps them pending; changed content cannot be overwritten. Acceptance does not execute Cells.

The Agent cannot claim that unexecuted code has run or replace code and output with prose. If an exact object, dataset, SDK
method, or analysis capability is unavailable, it must report that gap instead of silently substituting similar data.

When an explicitly different executable proxy exists, the Agent first asks you to confirm the research definition. Ordinary
input and Cell proposals pause until you answer. The answer persists across refresh, but confirmation does not make a proxy
equivalent to the original object.

## Send research to formal validation

Create a draft manually in Factor or Strategy, extract the algorithm and review the code, then explicitly run analysis or a backtest. Research no longer promotes executions or automatically generates drafts.

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
- [Understand Factor retained reports](/docs/help/factors/report-history)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
