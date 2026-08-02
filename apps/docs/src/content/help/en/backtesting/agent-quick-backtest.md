# Ask the strategy Agent for a quick backtest

While revising a strategy, you can ask the Agent to run one restricted quick backtest and explain the candidate from a compact summary. A quick backtest catches obvious problems; it is not the official result shown in the workbench.

## Appropriate uses

- Confirm that revised code runs.
- Compare one or two materially different candidates.
- Read a compact summary of return, drawdown, Sharpe, fills, and costs.
- Detect zero-trade rules, unsuitable dates, or reversed logic before a formal run.

Do not use it to try many values and keep only the best one. That repeatedly fits decisions to the same historical sample.

## Ask clearly

For example:

> Change the monthly purchase to 200 shares. Run one quick backtest with the current dates, capital, and costs, explain the most important difference, and then provide the complete code.

To override the range, state it explicitly:

> Run one quick backtest from 2022-01-01 through 2024-12-31 with CNY 1,000,000. Check only this candidate and do not search more parameters.

The Agent decides whether calculation is necessary. A purely explanatory question does not need a run.

## What happens during the run

1. The Agent freezes the candidate code and test parameters.
2. The system runs A-share rules in an isolated process.
3. The conversation shows tool-running and completion states.
4. The Agent reads compact metrics and explains the evidence.
5. If code changed, the reply still contains the complete candidate module.

Refreshing can reconnect to an active Agent turn. Cancelling the turn stops an unfinished quick backtest.

## What it never does

A quick backtest does not:

- Save the candidate as the strategy's official configuration.
- Replace the last result in the workbench.
- Produce the complete NAV chart and trade list.
- Deploy a version.
- Generate daily signals or orders.

A return number in chat therefore does not mean that the right-hand workbench result has changed.

## Run a formal backtest afterward

1. Read the Agent's explanation and limitations.
2. Inspect the complete code in the editor.
3. Verify dates, capital, and costs.
4. Select **Run backtest**.
5. Inspect NAV, drawdown, trades, logs, and costs in the formal result.
6. Consider scans or deployment only after the formal run completes.

If quick and formal results differ, verify that both used the same code and range; rely on the saved workbench configuration and official result.

## Common questions

### The candidate looks better. Can I deploy it immediately?

No. A quick run is candidate evidence from one sample and does not complete formal result review, out-of-sample validation, or deployment freezing.

### Why is there no NAV chart or trade list?

The conversation receives compact metrics only. Run a formal backtest for charts and trades.

### Can the Agent compare dozens of parameters?

That is not the purpose of quick backtesting. Use Scan experiments for numeric parameters, sizing schemes, or capital levels, and retain every result.

## Related articles

- [Continue revising and rerun](/docs/help/backtesting/revise-with-chat)
- [Run a backtest and read logs](/docs/help/backtesting/run-and-logs)
- [Compare several strategy parameters](/docs/help/backtesting/parameter-scan)

