# Read signal instructions

After generation completes, verify the dates and model equity before reading direction, shares, reference price, and estimated amount.

## The result

The screenshot contains one real buy instruction:

1. Strategy name, deployment date, code version, and status.
2. Manual generation action.
3. Run log.
4. Signal date, execution date, model equity, and email state.
5. Instruction table.
6. Reference-price note.

![A buy instruction on the Today page](/docs/images/help/zh/signals/signal-result-01.png)

## Verify the four summary fields

### Signal date

The strategy reads the close data from this session. The table's reference price also comes from this date.

### Execution date

The next trading day after the signal date. Actual action is normally taken after the execution-day open and remains subject to suspensions, price limits, and tradability.

### Model equity

The frozen strategy's model-account equity after running through the signal date. It converts target weights into shares and is not the user's live brokerage balance.

### Email notification

The state can be sent, failed, or skipped. Delivery and calculation are separate; an email failure does not mean signal calculation failed.

## Read the table

| Column | Meaning |
| --- | --- |
| Instrument | Security name and code |
| Asset | Stock or ETF |
| Direction | Buy or sell |
| Shares | Quantity based on model equity and target holdings, adjusted to the trading unit |
| Reference price | Unadjusted close on the signal date |
| Estimated amount | Reference price multiplied by shares |

Estimated amount does not include execution-day price changes, realized slippage, or every fee.

## Reference price is not a fill price

The page states that:

- Reference price is the unadjusted signal-day close.
- Actual execution occurs on the execution date.
- The opening price can differ from the previous close.
- Suspensions, price limits, liquidity, and order size can affect fills.

Do not record the table value as an actual fill or use it to calculate realized performance.

## What buy and sell mean

Instructions are differences between current model holdings and target holdings:

- Buy: increase the model quantity.
- Sell: reduce the model quantity.
- No action today: no target change produces a valid instruction.

They are not individual-security research recommendations. They are outputs from the frozen strategy under its data and capital assumptions.

## Run history

The lower section retains status and instruction count by signal date:

1. Latest state of the current deployment.
2. Current run summary.
3. History ordered by signal date.

![Today signal run history](/docs/images/help/zh/signals/signal-history-01.png)

“One instruction” means one table row. It does not mean a real trade has filled.

## Check before acting

1. Strategy name and code version are correct.
2. Signal and execution dates are correct.
3. Model equity matches the intended capital basis.
4. Codes, directions, and shares are reasonable.
5. The live account does not differ materially from the model's assumed holdings.
6. The securities are tradable on the execution date.

## Common questions

### Why are shares in multiples of 100?

Ordinary A-shares use board lots. Actual rules depend on the security type and market.

### Why does model equity differ from my account?

The model evolves from the deployed initial cash and historical strategy run. It does not read a brokerage account. The user must handle live-account differences.

### Does a table row mean an order was placed?

No. The page displays calculated instructions, not a broker acknowledgement or fill.

## Related articles

- [Generate today's signals](/docs/help/signals/generate-signals)
- [View history and pause a deployment](/docs/help/signals/history-pause)
- [Read trades and costs](/docs/help/backtesting/trades-costs)
