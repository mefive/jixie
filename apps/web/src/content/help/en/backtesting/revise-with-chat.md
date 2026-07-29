# Revise a strategy and run it again

After generating a strategy, use the conversation on the left to request a change. Verify the code after every change, then run the backtest again. A reply confirms that the request was handled; it does not create a new backtest result.

## Request a precise change

A useful request includes:

- The field or rule to change.
- Its new value or condition.
- Rules that must remain unchanged.

For example:

`Change the monthly purchase quantity to 200 shares; keep every other rule unchanged.`

Avoid “optimize it again.” That does not identify whether return target, risk, frequency, quantity, or instrument should change.

## Verify the change

1. Enter the requested change at the bottom left.
2. Press Enter.
3. Wait for the new reply to finish.
4. Find the changed value in the code.
5. Check that other important rules did not change.
6. Select **Run backtest**.

The numbered areas show:

1. The complete strategy conversation.
2. The reply for this change.
3. Updated code, where purchase quantity changed from 100 to 200.
4. The **Run backtest** button that must be selected again.

![Purchase quantity changed from 100 to 200 through a follow-up request](/help/zh/backtesting/strategy-revised-01.png)

If the reply reports a change but the code still has the old value, do not run. State the exact value again and identify what remains wrong.

## Why another run is required

Code changes do not calculate a result automatically:

- **Run backtest** becomes available again.
- Existing metrics still belong to the previous run.
- Leaving the strategy displays an unsaved-changes confirmation.
- The result matches the new code only after the new run completes.

Run first when the change is needed. Select **Discard changes** only when it is not.

## Inspect the revised result

The image shows the completed real backtest for the 200-share version:

1. Dates and capital used by this run.
2. Return, risk, cost, and fill metrics.
3. Trades and the fill count.
4. Logs for this run.

![Metrics, fill count, and logs after changing quantity and running again](/help/zh/backtesting/strategy-revised-result-01.png)

Review:

1. Confirm completion.
2. Check whether fill count agrees with the revised rule.
3. Open Trades and confirm a quantity of 200 shares.
4. Compare return, drawdown, costs, and turnover with the earlier version.
5. Record the change and settings.

The example does not buy again while already holding, so it has only one initial purchase in the five-year period. A low fill count follows the rule and does not mean monthly dates were omitted.

## Changing several rules at once

If instrument, date condition, quantity, and exit rule change together, it is difficult to explain the result difference. Prefer:

1. Change one main rule.
2. Run and record the result.
3. Make the next change.

If several changes are required together, list them individually and verify each one in the code.

## If the result deteriorates

That does not mean the change failed. Check:

- Whether the code implements the new rule.
- Whether fill quantities and dates changed.
- Whether fees and slippage increased.
- Whether dates and capital stayed consistent.
- Whether the earlier result was unusually favorable for one parameter.

Do not repeatedly alter parameters until historical return is highest and treat that combination as reliable.

## Related articles

- [Edit a strategy and run it again](/help/backtesting/edit-rerun)
- [Inspect backtest results](/help/backtesting/results-overview)
- [Compare several strategy parameters](/help/backtesting/parameter-scan)

