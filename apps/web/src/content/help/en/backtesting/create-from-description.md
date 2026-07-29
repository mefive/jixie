# Create a backtest from a strategy description

Start a new strategy by writing its trading rules in one or more sentences. The page converts the description into strategy code. The generated code, not the wording in the reply, is what the backtest runs, so always verify it first.

## What to include

Specify:

- **What to trade**: instrument name or code.
- **When to trade**: daily, weekly, monthly, or under a condition.
- **Entry rule**: price, valuation, ranking, or another explicit condition.
- **How much**: shares, contracts, number of holdings, or capital weight.
- **Exit rule**: date, holding period, stop, or ranking change.
- **Repeated purchases**: whether to buy again when already holding.

For example:

`Trade only CSI 300 ETF (510300.SH): buy 100 shares on the first trading day of each month; do not buy again while it is already held.`

Avoid descriptions such as “make a good strategy” or “help me earn money.” They contain no executable instrument, schedule, or quantity rule.

## Enter and send the description

1. Open the Backtest workspace.
2. Select **New**.
3. Write the complete rule in the input marked **2** below.
4. Press Enter or select the send button.
5. Wait for a strategy name, reply, and code.

The numbered areas show:

1. The new strategy page.
2. The strategy description input.
3. Provided examples.
4. The direct-code entry.

![Entering instrument, schedule, quantity, and holding rules for a new strategy](/help/zh/backtesting/strategy-description-01.png)

Examples demonstrate description structure. Verify the generated code even when starting from an example.

## Verify the generated result

The numbered areas show:

1. The strategy name derived from the description.
2. The description and reply.
3. The code used by the backtest.
4. The **Run backtest** button.

![Strategy name, conversation, and code generated from a CSI 300 ETF description](/help/zh/backtesting/strategy-generated-01.png)

Before running, check:

1. The instrument code is `510300.SH`.
2. The schedule is monthly.
3. An order is placed only when no position is held.
4. The purchase quantity is 100 shares.
5. No unexpected instrument or exit rule was added.
6. Dates, capital, and costs are correct.

The example code uses `ctx.period('monthly')` to identify months and buys 100 shares when the position is zero. Even without reading every line, find and verify the instrument, schedule, direction, and quantity.

## If the description and code differ

Do not run yet. State:

- What is wrong.
- The exact replacement rule or value.
- What must remain unchanged.

For example:

`Change the monthly purchase quantity to 200 shares; keep every other rule unchanged.`

Wait for the code to update and verify it again. Use the [Strategy SDK](/docs) when you need the exact code behavior.

## If no code is generated

1. Check the error shown on the left.
2. Confirm that the description has an instrument, condition, and quantity.
3. Remove data conditions that the product does not support.
4. Send a clearer version once.
5. If it still fails, record the original description and error.

Do not run default code as a substitute when the intended rule was not generated.

## Related articles

- [Revise a strategy and run it again](/help/backtesting/revise-with-chat)
- [Understand the Backtest workspace](/help/backtesting/workspace)
- [Set backtest parameters](/help/backtesting/run-settings)

