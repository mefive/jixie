# Research documents and current output

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Documents in the **Current** sidebar list store the current editable Markdown/Python cells, dependency state, and the Research Agent
conversation attached to the same document. Reopening a document restores saved source and output; edited code that has not
been rerun remains stale instead of being presented as current evidence.

## Current document

- The title and cell source remain editable and are protected by document-level autosave.
- Single-cell, affected-branch, and Agent-authorized runs are exploratory operations that update current cell output.
- Agent changes have durable review records; refresh does not lose pending, accepted, reverted, or conflicted state.
- Deleting a document removes its cells, conversation, and run diagnostics. It does not delete market data or independently created
  Factors and Strategies.

## Search, archive, and restore

1. Select **Current** or **Archived** on the left.
2. Enter keywords in **Search titles or recent content**. Search matches titles and content previews in that list, not the full text of every historical output.
3. For a study you do not currently need, open its item menu and select **Archive**. Source, outputs, conversations, and run diagnostics are retained.
4. To continue, switch to **Archived**, select **Restore** in the item menu, then open it from **Current**.

Wait for an active Agent turn or document run to finish before archiving.

**1** searches titles or recent content in the current list; **2** opens the document menu.

![Current interface and controls](/docs/images/help/en/research/document-list-current.png)

## Permanently delete

Only archived items offer **Permanently delete**. Review the confirmation first: the study's Cells, outputs, Agent history, and full-run diagnostics are removed and cannot be recovered. Independently created Factors and Strategies remain, but their original research source may no longer open. Use Archive when you only want to organize the list.

**1** switches to Archived; **2** offers Restore and Permanently delete. The capture only opens the menu; nothing is deleted.

![Current interface and controls](/docs/images/help/en/research/document-list-archived.png)

## Current output and clean runs

**Run full document in a clean environment** resets Python, executes current code in dependency order and updates Cell output. Editing marks mismatched output stale until rerun.

Complete execution snapshots, formal research evidence, promoted versions and the run-history drawer are retired. Rerunning after data changes reads current data; original inputs cannot be restored.

## Embedded chat analysis

[Embedded analysis](/docs/help/research/embedded-analysis) remains editable after success and keeps only the latest run per draft. Continuing in Research copies current code and parameters and fetches current data when run.

## Related articles

- [Run, stop, and reset research](/docs/help/research/run-control)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)
