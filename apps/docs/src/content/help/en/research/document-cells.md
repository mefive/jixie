# Build a research document with Cells

A research document contains Markdown Cells and Python Cells. Use Markdown for the question, prespecified hypothesis, formulas, and conclusions. Use Python to load data, calculate, and produce outputs. Keeping both in one document makes the reasoning and the actual computation reviewable together.

## Create a study

1. Open **Research** in the top navigation.
2. Select **New research** on the left.
3. Choose **CSI 300 vs CSI 500** for a complete runnable example, or **Blank research** when you already have a specific question.
4. Open the new document under **Research documents**.
5. Use the edit icon beside the title to rename it.

The markers below identify New research, the complete example, and Blank research.

![Research templates and the New research entry](/docs/images/help/zh/research/document-cells-01.png)

## Add and edit Cells

1. Select the plus sign between two Cells or at the end of the document.
2. Choose **Markdown** or **Python**.
3. For a Markdown Cell, select its edit icon, enter the content, and confirm the edit.
4. Type directly in a Python Cell. The editor provides Python and current Research SDK assistance.
5. Use the delete icon in a Cell header to remove it. First check that downstream calculations do not depend on it.

A useful order is to write the Markdown first, then its Python. For example, state that you will compare monthly CSI 300 and CSI 500 returns from 2020 through 2025 before loading and analyzing those series.

![A research document with Markdown and Python Cells](/docs/images/help/zh/research/document-cells-02.png)

## Read the save state

The Cell header shows **Unsaved**, **Saving**, or **Saved**. Source changes are saved automatically; there is no separate Save button.

- Unsaved: the local source has just changed.
- Saving: the document is being updated.
- Saved: the current source is persisted.

Wait for Saved before leaving. If the same document changed elsewhere, review the conflict instead of repeatedly refreshing and overwriting one version.

## Understand dependencies and stale output

The footer of a Python Cell lists the variables it defines and depends on. These names form the upstream and downstream dependency graph.

After upstream source changes, downstream Cells become **stale**. Their old outputs remain visible for comparison but no longer represent the current source. Expensive calculations do not run automatically; you choose whether to run one Cell, the affected downstream branch, or the full document.

## Common questions

### Why did editing Markdown not rerun Python?

Markdown does not execute code. A calculation needs a rerun when Python source or one of its dependencies changes.

### Does deleting a Cell delete old results?

It removes that Cell and its output from the editable document. Earlier successful full-run snapshots remain immutable in Full run history.

## Related articles

- [Run, stop, and reset research](/docs/help/research/run-control)
- [Research documents and run history](/docs/help/research/records)

