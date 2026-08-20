# Hand research to Factor or Strategy

The Research workbench supports open exploration. FactorReport and the Backtest workspace provide constrained formal validation. Handoff is available from a successful immutable full run, not directly from the current draft or a single-Cell output.

## Create a reproducible snapshot first

1. Verify the question, prespecified direction, dates, frequency, instruments or universe, and decision criterion in Markdown.
2. Select **Clean full run**.
3. Wait for every Cell to succeed.
4. Open **Full run history** and select the run.
5. Select **Promote as research version**, then enter a version name, tags, and notes.

Promotion names an existing successful snapshot; it does not calculate again. The read-only snapshot preserves source, outputs, dependencies, and environment summary, and indicates whether the editable draft has since changed.

![A promoted research version in a read-only snapshot](/docs/images/help/zh/research/handoff-01.png)

## Generate a Factor draft

When the snapshot contains a clear point-in-time signal supported by platform data:

1. Select **Generate Factor draft** in the promoted version.
2. Wait for the signal definition and Python `py-v1` code to be prepared.
3. In Factor Research, review inputs, direction, window, missing values, and universe line by line.
4. Check the source card for the originating version, extracted summary, and remaining validation items.
5. Configure and explicitly run FactorReport. Publish only from an approved report matching the current definition.

Supported universe, dates, frequency, filters, and prespecified direction can become suggested parameters. The handoff does not run a report, reveal Holdout, or publish the Factor automatically.

Conversion can be rejected when a study describes only a relationship and no signal computable at each decision time. Return to the document and specify the inputs and rule.

## Generate a Python Strategy draft

When the snapshot also defines instruments or universe, signal direction, rebalance or entry/exit rules, and position sizing:

1. Select **Generate Python Strategy draft**.
2. Review the source notice and `py-v1` code in the Backtest workspace.
3. Verify dates, initial capital, costs, instruments, and position rules.
4. Explicitly select **Run backtest**, then inspect results and logs.

A predictive relationship without portfolio and trading rules belongs in Factor first. A Strategy draft does not run automatically and is not automatically deployed to Today Signals.

## Boundaries that remain after handoff

- The source snapshot does not change with later draft edits.
- The Factor or Strategy draft is an independent object and does not write back to the snapshot.
- Exploratory charts and Agent explanations are not formal evidence. FactorReport, Holdout, costs, capacity, and backtests remain separate checks.
- Historical success does not guarantee future returns or constitute trading advice.

## Related articles

- [Research documents and run history](/docs/help/research/records)
- [Write a Factor in Python](/docs/help/factors/python-factor)
- [Write a strategy in Python](/docs/help/backtesting/python-strategy)

