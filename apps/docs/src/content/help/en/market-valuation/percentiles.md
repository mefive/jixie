# Interpret historical percentiles correctly

A historical percentile answers, “Where is the current value within its own history?” It does not answer whether the market will rise or fall next.

## How the page calculates it

For one metric, the page counts valid trading days whose values are at or below the current value:

$$
\text{Historical percentile}
=
\frac{\text{Valid days at or below the current value}}
{\text{All valid days in the comparison period}}
$$

If 800 of 1,000 valid trading days are at or below the current value, the percentile is 80%.

- 80% means the current value is at or above about eight tenths of historical days.
- 20% means it is at or above about two tenths of historical days.
- It does not mean an 80% probability of rising or a 20% probability of falling.

## Three-year percentiles on the Market page

The Market page compares current activity, breadth, trend, and crowding separately with valid history from the latest three years for the same scope.

Area 2 below contains the four percentiles, and area 4 contains the corresponding history:

![Three-year percentiles for market metrics](/docs/images/help/zh/market-valuation/market-overview-01.png)

Interpret only the same metric and scope together. “CSI 300 crowding at the 90th percentile” means crowding is high relative to its own latest three years. It does not mean a 90% probability of reversal.

## Two percentiles on the Valuation page

The Valuation page displays:

- Ten-year percentile: a natural-date lookback of ten years from the update date.
- All-history percentile: from the first available valuation date for that index.

Area 2 below shows both, while area 4 changes the chart window:

![Ten-year and all-history valuation percentiles](/docs/images/help/zh/market-valuation/valuation-history-01.png)

Changing the chart to five years does not change the card's ten-year percentile. The chart window controls the visible curve; the card uses its labeled fixed period.

## Why duration affects the percentile

The calculation weights trading days. A low-valuation state that lasts 200 trading days contributes 200 observations rather than one event.

Therefore:

- A long low-value period adds substantial weight to low observations.
- A short spike may contribute only a few days.
- The percentile describes the distribution of trading days, not the count of independent market cycles.

## What a percentile cannot establish

A low valuation percentile does not establish:

- An immediate rise.
- Limited further downside.
- Stable future earnings.
- That one index is absolutely cheaper than another.
- That a full position should be opened now.

High activity, trend, or crowding percentiles also cannot prove continuation or immediate reversal.

Possible reasons include:

- Current earnings quality can differ from history.
- Index constituents and industry composition change.
- Interest rates, risk appetite, and market rules change.
- An extreme state can persist for a long time.

## Use percentiles correctly

1. Confirm the metric, scope, and update date.
2. Read the current value and historical curve together.
3. Compare ten-year and all-history results for long-run shifts.
4. Consider earnings, breadth, costs, and the strategy rule.
5. If used in a strategy, write an explicit rule and test it in backtests and out-of-sample data.

A percentile provides historical context. It is not a standalone buy or sell button.

## Common mistakes

- Reading a 90th percentile as a 90% probability of decline.
- Treating equal percentiles from different indices as equal absolute valuation.
- Reading only the percentile without the value or data date.
- Assuming the card changes to five years when only the chart range changes.
- Using information that was not available on the historical date.

## Related articles

- [View index valuation](/docs/help/market-valuation/index-valuation)
- [Understand the four market metrics](/docs/help/market-valuation/market-metrics)
- [Formal holdout and out-of-sample results](/docs/help/factors/holdout-results)
