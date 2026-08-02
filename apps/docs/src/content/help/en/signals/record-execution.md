# Record actual fills and compare execution

After signals are generated, the system maintains model, simulated, and actual account layers. Simulation settles from market data; the actual account uses only fills recorded by the user. Recording a fill never sends an order to a broker.

## Three account layers

- **Model**: theoretical positions and equity under the frozen strategy's model prices and rules.
- **Simulation**: starts from the same baseline and settles with actual opens, suspensions, price limits, T+1, fees, and slippage.
- **Actual**: applies only trades explicitly recorded as executed by the user.

The numbered areas show:

1. Three equity values and the execution-rate summary.
2. Model, simulated, and actual equity curves.
3. Instruction, simulated fill, and actual execution state.

![Model, simulated, and actual account comparison](/docs/images/help/zh/signals/signal-execution-overview-01.png)

Simulation is not the brokerage account. It cannot know that the user forgot an order, changed quantity, or received another price.

## Record one execution

1. Open **Daily signals**.
2. Select the relevant signal date from run history.
3. Find the instruction in the execution table.
4. Select **Record**.
5. Choose **Executed** or **Not executed**.
6. For an executed trade, verify actual shares, price, and fee.
7. For a skipped trade, choose a reason.
8. Add a note when useful.
9. Select **Save execution**.

The numbered areas show:

1. Instrument and execution dialog.
2. Execution status.
3. Actual shares; price and fee follow immediately below.
4. Save action.

![Actual execution entry dialog](/docs/images/help/zh/signals/signal-execution-record-01.png)

If fee is blank, the system estimates it with the model schedule. Enter the real broker fee when known.

## Executed and not executed

For **Executed**:

- Actual shares may differ from model shares.
- Use the average fill price from the broker confirmation.
- Record partial fills at their actual shares; do not inflate them to the model quantity.

For **Not executed**, record a reason such as a price limit, suspension, forgotten order, manual override, or other. A skipped instruction does not enter actual holdings.

Saving replays the actual account chronologically from its initial baseline. Editing an old record can change later actual equity and holdings.

![Execution rate and actual account after recording a fill](/docs/images/help/zh/signals/signal-execution-complete-01.png)

## Execution rate

Execution rate uses instructions with a recorded decision:

$$
\text{Execution rate}=\frac{\text{instructions recorded as executed}}{\text{instructions with a recorded decision}}
$$

Pending instructions are outside the denominator. A 100% rate means every decided instruction was executed, not that the entire history has been reviewed.

## Average adverse price deviation

The system compares actual and simulated prices:

- A higher actual buy price is adverse.
- A lower actual sell price is adverse.
- The result is shown in basis points; 100 bp equals 1%.

At least one comparable actual fill is required. Historical deviation describes past execution and does not forecast the next fill.

## Edit history

Open a completed row to revise it. Compare against broker records first, especially date, side, shares, price, and fee. Never change real records to improve execution rate or performance.

## Important limits

- The system does not read the broker account or validate entered fills automatically.
- Recording is not order placement.
- Simulation remains pending until execution-day market data is published.
- The actual layer supports personal execution review and is not a legal brokerage statement.

## Related articles

- [Read signal instructions](/docs/help/signals/read-signals)
- [Use and record conditional orders](/docs/help/signals/conditional-orders)
- [View history and pause a deployment](/docs/help/signals/history-pause)
