# Collaborate with Research Agent

Research Agent can read the current document and Cell state, refine a research question, look up the Research SDK, propose Cell changes, and explain real outputs after execution. You review both its prose and code. A completed proposal does not run automatically.

## Make a precise request

1. Select the chat icon in the upper-right corner to open **Research Agent**.
2. State the instruments, dates, frequency, variables, method, and decision criterion.
3. For an edit, identify the target Cell, content to preserve, and expected output.
4. After sending, watch phases such as preparing data or generating a proposal. A progress phase is not a validated conclusion.

When an exact instrument, dataset, or SDK method is unavailable, the Agent should inspect the current catalog or state the gap. Do not accept a silent substitution with a merely similar measure.

## Review Cell changes

A proposed edit appears as a change card and an inline diff in its target Cell:

- red lines are old content proposed for removal and are read-only;
- green lines are new or changed content and remain editable;
- created, modified, and deleted Cells are listed separately;
- line counts help locate changes but do not measure their quality.

![Inline review of Research Agent Cell changes](/docs/images/help/zh/research/agent-collaboration-01.png)

Check data fields, dates, formulas, dependencies, missing values, and conclusion wording. For a small correction, edit the green current version directly instead of asking for the same proposal again.

## Accept, undo, or reject

- Select **Accept current version** to keep the version you reviewed and edited.
- Select **Undo this Agent change** to restore the Cell content from before the review.
- Reject a still-pending proposal when it should not be applied.

Acceptance changes source only; it does not execute the Cell. Its output normally becomes stale afterward.

## Run a proposal

Select **Run Cells affected by proposal** to execute the changed branch explicitly. A proposal can have a bounded number of correction attempts. Each attempt preserves its status and outcome; a failed attempt is not hidden as success.

After execution, select **Ask Agent to explain this run**. An explanation should cite real output, errors, or warnings. If the proposal has not run, expected results cannot be presented as computed facts.

![An accepted and executed Agent change](/docs/images/help/zh/research/agent-collaboration-02.png)

## What to delegate

Good uses include explaining a formula, generating a call from a confirmed catalog entry, reducing repeated code, proposing robustness checks, and explaining existing output.

You still decide the research question, prespecified direction, sample, whether to accept and run changes, how to interpret conflicting evidence, and whether to enter formal Factor or Strategy validation.

## Related articles

- [Use the research data catalog](/docs/help/research/data-catalog)
- [Hand research to Factor or Strategy](/docs/help/research/handoff)

