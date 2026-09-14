# Inspect data in Factor and Strategy conversations

In Factor Research or the backtest workbench, ask the Agent for a bounded calculation on existing data. An embedded analysis card keeps the table, chart or value in the conversation. Open **Code, sources and history** to inspect its Python, parameters, actual inputs and errors.

For example: “Plot the ten groups in this factor report and calculate the highest group minus the lowest.” For repeated method changes or a document combining tables and conclusions, continue from the card into Research.

## Start from a question

- Open a preset, custom or composite factor to discuss its definition or an existing report. Custom factor authoring continues to use the main code editor.
- Open a strategy and a completed backtest report to inspect saved equity, returns or trades. This analysis does not rerun the strategy.
- A selected completed report is referenced by default. Clear **Use selected report** to omit that automatic reference for the next question. Earlier questions retain their original sources.
- Select **Reference data** beside the composer for other inputs. It uses the same catalog as Research: choose an instrument, dates, frequency, fields or a specific report. A question can reference up to eight requests.

**Selecting a reference does not fetch data.** In Research, the catalog inserts an SDK call. In chat, it saves the requested source and scope so the Agent can write an explicit Python call. Only **Data actually used** in the run record proves what reached the calculation.

When a material choice is unresolved—currency, adjustment, sample period or a proxy—the Agent should explain the alternatives and ask you to choose. Simple facts and small aggregates can still be queried and answered directly.

Python reads through SDK methods in the data catalog, not arbitrary SQL query results. The Agent can still query simple facts outside the catalog. If a calculation needs a data interface that is not available, it should explain the gap rather than copy chat-visible rows and present them as complete retained inputs.

## Read the evidence

Check the sample and processing method before relying on the value. Details include:

1. The code, parameters, time and status of this exact run.
2. The host's saved definition, selected report ID and source fingerprint. This is not a snapshot of unsaved editor changes.
3. Actual SDK arguments, dates, fields, row counts or structured responses, diagnostics and input fingerprints. **View retained input** previews the original response, up to 20,000 characters; its fingerprint covers the full stored response.
4. Date alignment, missing values, empty samples, constant series, units and costs. These choices belong in readable code and output. A successful execution does not establish a valid method.

An embedded run allows 16 SDK requests, 32 MiB of cumulative input and a 30-second execution budget; queue time is separate. Individual SDK methods and outputs have additional limits. Missing data, limits and execution failures should produce explicit feedback rather than a zero statistic. If no SDK input is recorded, inspect constants or generated data in the code.

The run is saved before the Agent's final explanation. Cards survive reloads. If the answer fails, stops or disconnects, **Analysis history** can recover submitted runs.

## Fixed versions and changes

The first successful run fixes that version's code, parameters and context. Earlier failed or cancelled runs remain available. An unsuccessful version can be edited and retried.

After success, select **Edit as a new version**, change Python or parameters, and run. The new version retains its parent; the original message keeps its original run. Selecting another history entry does not rewrite an earlier answer.

**Run with current data** creates another run and reads currently available data. It preserves the old result. Rerunning an old draft whose source has since changed creates a version from that run's source. To calculate with the original retained inputs, continue in Research.

## Continue in Research

Select a successful run with complete retained inputs and choose **Continue in Research**. The editable document contains an explanation, parameters and the original Python. Repeated clicks open the same copy.

The default is **Use retained inputs**. Change the algorithm or add calculations over those inputs; SDK requests must match the original retained requests. New requests or changed arguments fail explicitly instead of silently fetching current data.

Choose **Fetch current data** when you want new data. Changing modes makes existing Python outputs stale and clears interpreter state, so rerun the document. Full-run history records the input mode and original run ID. The original analysis stays fixed, even if you delete its Research copy.

Retained inputs support recomputation; they do not guarantee bitwise identical results across runtime environments. Ordinary Research documents retain their editing, dependency and execution-history rules.

## Charts in older conversations

Older charts stored queries and calculation code without a full snapshot of the original points. Opening them reruns that specification against the current database, as stated on the card. The chart may therefore differ from the old answer. Missing data and execution failures remain visible; original results are not reconstructed or invented. New embedded analyses retain the outputs of each run.

## Move to formal validation

An analysis card explains a calculation on existing samples. It does not create a new factor evaluation, launch a backtest, reveal a holdout, publish a factor or operate an account.

Use the factor workbench and research card to validate a candidate. Existing Agent-driven factor exploration reports retain their research-card and holdout rules. Explicitly run the strategy in the backtest workbench to validate trading rules. Research's existing promotion and handoff workflow can also create Factor or Strategy drafts.

- [Use the research data catalog](/docs/help/research/data-catalog)
- [Research documents and run records](/docs/help/research/records)
- [Ask the factor Agent to run exploratory analysis](/docs/help/factors/agent-explore-analysis)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
