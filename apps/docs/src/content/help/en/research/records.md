# Research documents and run history

The **Research documents** sidebar stores the current editable Markdown/Python cells, dependency state, and the Research Agent
conversation attached to the same document. Reopening a document restores saved source and output; edited code that has not
been rerun remains stale instead of being presented as current evidence.

## Current document

- The title and cell source remain editable and are protected by document-level autosave.
- Single-cell, affected-branch, and Agent-authorized runs are exploratory operations that update current cell output.
- Agent changes have durable review records; refresh does not lose pending, accepted, reverted, or conflicted state.
- Deleting a document removes its cells, conversation, and run history. It does not delete market data or independently created
  Factors and Strategies.

## Complete runs and promoted versions

**Run full document in a clean environment** freezes the current document revision, cell order and source, dependency DAG,
runtime version, and outputs as an immutable `ResearchExecution`. Editing the live document while that run is active does not
change the snapshot.

Every complete run appears in the document's run history. A successful run can be explicitly promoted with a version name,
tags, and notes. Promotion names an existing snapshot; it does not rerun or rewrite results. A Factor or Strategy created from
that snapshot retains its provenance and backlink.

Use this sequence:

1. Select the history icon at the top to open **Full run history**.
2. Verify the status, document revision, Cell count, and completion time.
3. Open an entry to inspect its read-only source and outputs.
4. When a successful run should become a downstream baseline, select **Promote as research version**.
5. Enter a version name, tags, and notes, then confirm.

![Full run history and promotion entry](/docs/images/help/zh/research/records-01.png)

A complete run proves that this source produced these outputs in that environment; it does not prove that the method is correct
or investable. The snapshot does not copy the underlying market database. If data is revised later, run the document cleanly
again to create a separate snapshot and review the two records independently.

## Related articles

- [Run, stop, and reset research](/docs/help/research/run-control)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
