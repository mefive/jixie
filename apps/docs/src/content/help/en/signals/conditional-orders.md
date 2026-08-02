# Use and record conditional orders

A strategy can create stop-loss, trailing-stop, limit-buy, and take-profit conditions. Daily signals lists active conditions under **Pending conditional orders**. The user must recreate them in the broker client for broker-side monitoring; the system never connects to the broker or places them automatically.

## Four condition types

| Condition | Purpose | Verify on the page |
| --- | --- | --- |
| Stop loss | Sell eligible holdings when price reaches a fixed trigger | Sell side, shares, and trigger |
| Trailing stop | Sell after a specified drawdown from the known high | Drawdown percentage and current trigger |
| Limit buy | Buy only at or below a limit | Buy shares and maximum price |
| Take profit | Sell after reaching a gain from position cost | Gain percentage, shares, and trigger |

A condition becomes eligible on the next trading day after declaration. It is neither a same-day fill nor a fixed next-open market instruction.

## Read the pending list

The numbered areas show:

1. Current signal and execution dates.
2. Conditional-order guidance.
3. Type, side, shares, trigger, and trailing percentage.

![A pending trailing stop in Daily signals](/docs/images/help/zh/signals/signal-conditional-01.png)

Trigger prices are unadjusted so they can be compared with broker quotes. Available order types, validity, and trigger rules depend on the broker.

## Recreate it at the broker

1. Verify instrument name and code.
2. Verify buy or sell side.
3. Verify real shares and sellable holdings.
4. Verify the unadjusted trigger or trailing percentage.
5. Choose the corresponding conditional type in the broker client.
6. Set its validity period.
7. Submit and confirm broker-side status.
8. Treat broker orders and fills as the authoritative actual record.

Broker terminology can differ. If no equivalent condition exists, do not silently substitute another rule.

## Historical trigger assumptions

A daily-bar backtest has only open, high, low, and close:

- A fixed stop triggers when the daily low reaches it; a downward gap uses the open.
- A limit buy triggers when the low reaches it and never simulates a price above the limit.
- A trailing stop uses only the high-water mark known before the day and does not look at that day's future high.
- If take-profit and stop-loss levels are both touched with unknowable order, the engine uses a conservative outcome.
- Suspension, price limits, T+1, cash, slippage, and fees still apply.

These are auditable historical assumptions, not a guarantee of tick-level broker execution.

## Modify or cancel

A condition remains in the model until triggered, cancelled, or made irrelevant by holdings. Editing strategy code does not alter the currently deployed frozen version; run a formal backtest and redeploy first.

When a condition disappears from a new signal page, also verify whether an old broker-side order still exists. The system cannot cancel it for the user.

## Conditional orders and execution rate

Pending conditions are outside the execution rate for next-open market instructions. Whether the broker-side condition was created, triggered, and filled must be checked separately.

Do not record “created at broker” as “filled.”

## Common questions

### Does a row mean the order was placed?

No. It is an operational checklist generated from the model.

### Why can the trigger change?

A trailing stop updates with the known high-water mark. Compare broker settings with the latest generated list.

### Why did the backtest trigger when the live order did not fill?

Daily bars cannot reconstruct tick order, and broker conditions, gaps, liquidity, and validity can differ. Record the difference for execution review.

## Related articles

- [Read signal instructions](/docs/help/signals/read-signals)
- [Record actual fills and compare execution](/docs/help/signals/record-execution)
- [Deploy a backtested strategy](/docs/help/signals/deploy-strategy)
