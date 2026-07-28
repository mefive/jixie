# Run your first screen

This example finds stocks with trailing PE below 15 and dividend yield above 3%, then sorts them by total market capitalization from largest to smallest.

## Before you start

- Sign in.
- Remember that matching a screen does not mean a stock should be bought.
- Use the fixed text below so that you can compare your page with the example.

## Enter the conditions

1. Select Screener in the top navigation.
2. Wait for the input in the center of the page.
3. Enter `筛选市盈率TTM低于15、股息率大于3%的股票，按总市值从高到低排列` in **1**.
4. Press Enter. The hint marked **2** shows the keyboard action.

![Condition input on the Screener page](/help/zh/getting-started/first-screen-01-query.png)

Wait for the conditions to be processed and the result to appear. Do not send the same request repeatedly while it is running.

## Inspect the result

1. Review the interpreted conditions in **1**.
2. Inspect the result table in **2**.
3. To keep the result, select the pin button marked **3**.

![Interpreted conditions, result table, and pin button](/help/zh/getting-started/first-screen-02-result.png)

Rows in the table mean the screen completed. The list can change when the source data changes.

## Verify the result

Check that:

1. Trailing PE is below 15.
2. Dividend yield is above 3%.
3. Total market capitalization is sorted from largest to smallest.

Select a stock code to open its detail page.

## What the terms mean

- **Trailing PE** compares market value with profit from the most recent twelve months.
- **Dividend yield** compares dividends with share price. A past yield does not guarantee future dividends.
- **Total market capitalization** is share price multiplied by total shares outstanding.

The screen answers which stocks match the conditions, not whether now is a good time to buy.

## Common problems

If no rows appear, remove one condition and try again. If the result looks wrong, review the interpreted conditions and the displayed data date.

## Related articles

- [Stocks, ETFs, and indices](/help/basics/stocks-etfs-indices)
- [Run your first backtest](/help/getting-started/first-backtest)
