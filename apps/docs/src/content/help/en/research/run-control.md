# Run, stop, and reset research

The workbench does not execute expensive computation after every edit. Choose one Cell, an affected branch, or the full document according to the scope of the change.

## Run the current Cell

Select the run icon in a Cell header to execute only that Cell. This is useful for a small check when:

- its upstream variables already exist in the current runtime; and
- those values were not produced by changed, stale source.

If a dependency is missing or stale, run the upstream work first or use an affected-branch or full-document run.

## Run the current Cell and affected downstream Cells

Select the branch icon, **Run current Cell and affected downstream**. The system executes the current Cell and stale dependants in dependency order, without running independent Cells outside that branch.

![Run a Cell and its affected downstream branch](/docs/images/help/zh/research/run-control-01.png)

Use this after changing one data-loading or calculation step. Review which Cells will be included before running.

## Clean full run

Select **Clean full run** at the top to:

1. start a clean Python environment;
2. execute all runnable Cells in document and dependency order;
3. freeze the source, dependencies, runtime, and outputs;
4. create an immutable entry in **Full run history** after success.

Use a clean full run before comparison, promotion, or Factor/Strategy handoff. Success in the current interactive state alone does not prove the document runs from zero.

## Stop the current run

During a long calculation, the run icon becomes a stop control. Select **Stop current run** to interrupt it.

![Stop a long-running calculation](/docs/images/help/zh/research/run-control-02.png)

Downstream Cells that did not finish receive no new output. Old output may remain visible and stale; correct the source and run again.

## Reset the environment

Select **Reset environment** to clear the interactive Python state. Document source remains saved, but in-memory variables and temporary objects disappear. Run the required upstream Cells again or perform a clean full run.

Reset when:

- a result depends on a temporary variable no longer present in source;
- imports or runtime state behave unexpectedly; or
- you want to verify that the document does not depend on unrecorded interactive steps.

## Common questions

### I see old output and Stale

This is a safeguard, not a failed automatic rerun. It tells you the source and output differ. Choose the appropriate run scope.

### Can I promote an interrupted run?

An incomplete full run cannot become a successful promoted version. Correct or reduce the calculation and run the full document cleanly again.

## Related articles

- [Build a research document with Cells](/docs/help/research/document-cells)
- [Research documents and run history](/docs/help/research/records)

