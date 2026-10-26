# Inspect data in Factor and Strategy chats

Ask the Agent for a bounded Python calculation on an existing report or selected data. The chat card shows tables, charts, values or errors. Select **Code and results** to inspect current Python and parameters.

## Reference data

Select a completed report in Factor or Strategy, or use **Reference data** to choose objects, dates, frequency and fields. Each turn accepts up to eight references. A selection describes a request; Python SDK calls fetch the actual data. Deleted reports and changed permissions make those reads fail.

![Data reference entry](/docs/images/help/en/research/embedded-reference.png)

Security search, coverage and universe screening use dedicated tools. Other calculations use Python SDK methods from the catalog. Arbitrary SQL is unavailable. The Agent should explain missing interfaces rather than invent data.

## Inspect and edit

Check the sample, date alignment, missing values, units and method before interpreting numbers. Successful execution does not establish methodological validity.

Successful drafts remain editable. Select **Edit code**, then save and run. Rerunning fetches current data and replaces the draft’s previous ordinary run and Job. Code is current; differing revisions mark output as needing a rerun. Removed run links explicitly fail without substituting another result.

Each calculation allows 16 SDK calls, 32 MiB of cumulative responses and 30 seconds of execution, excluding queue time. Limits, cancellation, missing data and calculation errors remain explicit. SDK responses and environment fingerprints are not retained for replay.

## Continue in Research

**Continue in Research** copies current code and parameters into an editable document; repeated clicks open the same copy. Successful, failed and cancelled analyses can be copied. Running the copy fetches current data. There is no retained/current input mode and no copy of old inputs or outputs.

Start formal factor analysis or strategy backtests explicitly in their workbenches. Embedded analysis does not automatically create or publish a Factor or Strategy.

Legacy chat charts show their title and retirement notice. Rebuild their calculations in Research when needed.

- [Research documents and current output](/docs/help/research/records)
- [Use the research data catalog](/docs/help/research/data-catalog)
