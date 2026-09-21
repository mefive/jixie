# Research documents and run history

Documents in the **Current** sidebar list store the current editable Markdown/Python cells, dependency state, and the Research Agent
conversation attached to the same document. Reopening a document restores saved source and output; edited code that has not
been rerun remains stale instead of being presented as current evidence.

## Current document

- The title and cell source remain editable and are protected by document-level autosave.
- Single-cell, affected-branch, and Agent-authorized runs are exploratory operations that update current cell output.
- Agent changes have durable review records; refresh does not lose pending, accepted, reverted, or conflicted state.
- Deleting a document removes its cells, conversation, and run history. It does not delete market data or independently created
  Factors and Strategies.

## Search, archive, and restore

1. Select **Current** or **Archived** on the left.
2. Enter keywords in **Search titles or recent content**. Search matches titles and content previews in that list, not the full text of every historical output.
3. For a study you do not currently need, open its item menu and select **Archive**. Source, outputs, conversations, and run history are retained.
4. To continue, switch to **Archived**, select **Restore** in the item menu, then open it from **Current**.

Wait for an active Agent turn or document run to finish before archiving. Archiving organizes the document list; **Promote as research version** marks a successful immutable run. They serve different purposes.

## Permanently delete

Only archived items offer **Permanently delete**. Review the confirmation first: the study's Cells, outputs, Agent history, and full-run history are removed and cannot be recovered. Independently created Factors and Strategies remain, but their original research source may no longer open. Use Archive when you only want to organize the list.

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

## Embedded analysis in chat

For a bounded calculation on an existing report or selected data, use an [embedded analysis card](/docs/help/research/embedded-analysis). It retains Python, inputs and outputs, fixes a version on first success, and can continue in Research. That copy defaults to replaying the retained inputs; ordinary document history rules remain unchanged.

## Related articles

- [Run, stop, and reset research](/docs/help/research/run-control)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
