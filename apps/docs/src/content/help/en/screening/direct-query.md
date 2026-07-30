# Query a stock or ETF directly

Screener can filter a list of stocks, query one named stock or ETF, or compare two instruments. Use a direct query when you already know the name or code.

## Before you start

1. Sign in and select Screener in the top navigation.
2. Select New chat on the left. It is marked **1** below.
3. Wait for the input in the center. It is marked **2**.

![New chat, input, conversations, and saved screens](/docs/images/help/zh/screening/conversations-01.png)

## Enter the query

Include the name or code and what you want to inspect. For example:

- `What is Moutai's current PE?`
- `Query 600519.SH`
- `Compare the CSI 300 ETF and gold ETF over the past year`

Include a period and comparison measure when relevant. “Compare performance over the past year” is clearer than “compare them.”

Press Enter to send. Use `Shift+Space` to insert a newline in the same message.

## Inspect the result

A direct query may return text, a table, or a chart. Check:

1. The name or code is the intended instrument.
2. The data end date is suitable.
3. The period used for change, valuation, or performance is correct.
4. Compared values use consistent units and periods.

A direct query does not automatically become a reusable criteria screen. To reuse a set of conditions, follow [Screen by criteria and inspect results](/help/screening/filter-results), then save the screen.

## Conversations

After the first message, the conversation appears under Chats on the left, marked **3**. Select it later to review or continue it.

Chats and Saved screens are separate. Saved screens are marked **4**; saving a screen does not replace its conversation.

## Common problems

### A similarly named instrument was returned

Enter the full name or security code. For example, `600519.SH` identifies Kweichow Moutai.

### The result is not a stock list

Direct questions may produce text or charts. To obtain a stock list, state criteria such as “stocks with PE(TTM) below 15 and dividend yield above 3%.”

### The data date is not today

Check the date shown in the result. On non-trading days, before an update completes, or when the source is delayed, the latest date may precede today.

## Related articles

- [Screen by criteria and inspect results](/help/screening/filter-results)
- [Use conversations](/help/screening/conversations)
- [Stocks, ETFs, and indices](/help/basics/stocks-etfs-indices)
