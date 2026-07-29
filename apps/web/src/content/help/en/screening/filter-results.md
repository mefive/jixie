# Screen by criteria and inspect results

A criteria screen finds stocks that satisfy several conditions at the same time. The page converts the request into visible, editable conditions and evaluates them against the current data.

## Enter the criteria

1. Select Screener in the top navigation.
2. Select New chat.
3. Enter a request such as:

   `Screen stocks with PE(TTM) below 15 and dividend yield above 3%, sorted by total market cap from high to low`

4. Press Enter.
5. Wait for the conditions and table. Do not resend the same request while it is running.

## Verify the interpreted conditions

![Conditions, snapshot summary, and result table](/help/zh/screening/filter-results-01.png)

The conditions actually used are marked **1**. Check:

- Field, such as PE(TTM), dividend yield, or total market cap.
- Operator: `<`, `≤`, `>`, or `≥`.
- Value and unit, such as `%` or 100M CNY.
- Sort field and direction.

The visible conditions are the rules executed by the page. If they differ from the request, edit them before assessing the result.

## Check the snapshot and counts

The line marked **2** shows:

- Snapshot date: the trading date used.
- Matches: all stocks satisfying the conditions.
- Shown: the number of rows currently listed.

Matches can exceed the displayed rows. Stocks beyond the displayed limit may still satisfy the screen.

## Read the table

The table is marked **3**.

| Column | Meaning |
| --- | --- |
| Name | Stock name and security code |
| Price | Price on the snapshot date |
| Change | Daily change; red is up and green is down |
| PE(TTM) | Price-to-earnings ratio using trailing twelve-month earnings |
| PB | Price-to-book ratio |
| Div yield | Dividend yield in the current data |
| Mkt cap | Total market capitalization |
| Turnover | Daily trading activity |

Select a row to open Stock detail in a new tab. The screen remains in the original tab.

## Verify the result

1. Check the snapshot date.
2. Check every operator, value, and unit.
3. Sample one or two rows and confirm the corresponding columns satisfy the conditions.
4. Check the sort field and the order of the first rows.

A match only means that the stock satisfied the rules on that snapshot date. It is not a forecast.

## No results

Try the following:

1. Check whether greater-than and less-than were reversed.
2. Check for excessive or conflicting conditions.
3. Relax one threshold.
4. Remove one condition and wait for the page to run again.

## Related articles

- [Edit conditions and sorting](/help/screening/edit-sort)
- [Save and rerun a screen](/help/screening/save-reuse)
