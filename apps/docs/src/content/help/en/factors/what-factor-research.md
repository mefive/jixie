# What factor research can answer

A factor is a numeric value calculated for every eligible stock on each comparison date. It may come from price, trading, valuation, or financial data. Factor research ranks stocks by that value, divides them into groups, and observes whether their subsequent returns differ consistently.

It studies historical patterns across groups of stocks. It does not predict that one stock must rise or fall on the next day.

## Understand a factor through earnings yield

**Earnings yield (1/PE_TTM)** is approximately the inverse of the price-to-earnings ratio:

> Earnings yield = trailing twelve-month earnings ÷ market capitalization

If two companies have the same earnings, the company with the lower market value has the higher earnings yield. The preset shown on the page calculates the value only for stocks with a positive PE.

On each rebalance date, the analysis:

1. Calculates earnings yield for every eligible stock.
2. Ranks the values from low to high.
3. Divides the stocks into ten groups, D1 through D10.
4. Observes each group's return over the next period.
5. Repeats the calculation over many historical months and summarizes the results.

If subsequent returns generally rise from D1 to D10, stocks with higher earnings yield had higher subsequent returns in that historical sample. This does not prove that earnings yield was the only cause.

## What the page helps you check

Factor research helps you check:

- **Direction**: whether higher factor values were followed by generally higher or lower returns.
- **Group differences**: whether the high and low groups differed materially.
- **Consistency**: whether the relationship kept the same direction in most periods.
- **Trading frictions**: whether turnover and costs materially reduce the result.
- **Sample definition**: how many observations remain after listing-age, liquidity, and risk-status filters.

The numbered areas are:

1. The **Factor library** tab.
2. The selected **Earnings yield (1/PE_TTM)** preset.
3. The read-only preset notice. You do not need to edit code for the first run.
4. Analysis dates, the run action, and results.
5. Run logs.

![Factor library, preset, analysis result, and logs](/docs/images/help/zh/factors/factor-workspace-01.png)

## What factor research cannot establish

One attractive result does not establish that:

- The same return will continue in the future.
- Every high-ranked stock will rise.
- Returns remain achievable after realistic costs.
- The best result selected after repeatedly changing dates and settings is reliable.
- Two variables that move together have a causal relationship.

Complete one preset analysis before learning custom factor code.

## How Factor Weather differs

Factor Research defines and tests a factor under user-selected dates, frequency, sample treatment, and costs, then saves an immutable report. Factor Weather accepts finalized single factors and continuously adds complete months under one fixed monthly method to monitor favorable and unfavorable phases.

Complete the definition, research card, and holdout work in Factor Research before pinning a factor. Recent weather cannot replace formal research or turn months you have already seen into out-of-sample data.

## Related articles

- [Run your first preset factor analysis](/help/factors/first-preset-analysis)
- [Set the analysis range and sample treatment](/help/factors/analysis-settings)
- [Read your first factor analysis result](/help/factors/results-overview)
- [Get started with Factor Weather](/help/factor-weather/getting-started)
