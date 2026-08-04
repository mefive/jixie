# Read Factor Weather cards

A Factor Weather card shows monthly after-cost long-short returns under the fixed method, together with trailing three-month and twelve-month returns, rolling IC, coverage, and turnover. Confirm the selected month before reading the other numbers.

## Select a historical month

The month strip runs from left to right. Red means the result matched the expected direction; green means it moved against that direction. A deeper color represents a larger after-cost long-short return.

1. Select a month in the strip.
2. The metrics at the top of the card update to end at that month.
3. When many months are present, drag the strip horizontally.
4. Hover over a month to see the month, direction-aligned net return, and raw IC.

![Select a historical month and inspect card metrics](/docs/images/help/zh/factor-weather/factor-weather-history-01.png)

Direction alignment changes only the display sign. A higher-values-first factor retains the raw direction; a lower-values-first factor reverses it. Raw Rank IC remains visible separately.

## Four primary metrics

- **Selected month**: direction-aligned after-cost long-short return for that month.
- **Trailing 3 months**: compound after-cost long-short return for up to the latest 3 months ending at the selection.
- **Trailing 12 months**: compound after-cost long-short return for up to the latest 12 months ending at the selection.
- **12-month mean IC**: direction-aligned mean of up to the latest 12 raw Rank IC observations ending at the selection.

Trailing $n$-month return is compounded rather than added:

$$
R_{n}=\prod_{j=1}^{n}(1+r_j)-1
$$

$r_j$ is the direction-aligned after-cost long-short return for month $j$. When fewer than $n$ months are available, the page uses the observations that exist.

## Details below the card

- **Raw Rank IC**: correlation between factor ranks and next-month return ranks, without changing its sign to match the expected direction.
- **Coverage**: final valid observations as a share of the candidate sample.
- **Top-decile turnover**: the share of the highest factor group replaced since the prior month.
- **Sample**: the number of stocks included in that month's analysis.

If coverage falls suddenly, first check financial-data availability, listing age, risk status, and liquidity filters. High turnover makes realistic transaction cost and capacity more important.

## Judge favorable and unfavorable phases

Check in this order:

1. Whether the selected month matched the expected direction.
2. Whether trailing three and twelve months agree.
3. Whether twelve-month mean IC changed in the same way.
4. Whether coverage and sample size remained stable.
5. Whether turnover rose materially.
6. Return to the immutable factor report for long-run groups, drawdown, and holdout evidence.

A short unfavorable phase does not automatically mean permanent factor failure. A run of favorable months also does not prove future effectiveness. Crowding, style rotation, data changes, and random variation can all contribute.

## Factor Weather and a factor report

| Factor Weather | Factor Research report |
| --- | --- |
| One fixed monthly method | Explicit user-selected frequency, dates, and method |
| Adds complete months over time | Immutable after the report is saved |
| Monitors recent state | Tests a definition and research hypothesis |
| Does not create out-of-sample evidence | Can freeze and reveal a formal holdout |

Recent strong weather cannot turn those same months into data that was not involved in factor selection.

## Common questions

### Why does the page end at last month?

The current month is incomplete. The page stores complete months only, so it does not compare a partial month with full months.

### Why can I not change a preset's direction?

A preset has a fixed economic definition and expected direction. Allowing repeated direction changes after seeing results would increase selection bias.

### Why does the three-month result differ from the sum of three monthly results?

The page compounds monthly returns. Adding them directly is only an approximation.

## Related articles

- [Get started with Factor Weather](/docs/help/factor-weather/getting-started)
- [Read your first factor analysis result](/docs/help/factors/results-overview)
- [Rank IC, ICIR, and IC decay](/docs/help/factors/rank-ic-icir)
- [Turnover, trading costs, and net returns](/docs/help/factors/turnover-costs)
