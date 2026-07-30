# Understand the four market metrics

The Market page displays activity, breadth, trend, and crowding separately. Each answers a different question.

## Trading activity

Trading activity is the 20-trading-day average of float-market-cap-weighted turnover:

$$
\text{Activity}_t
=
\frac{1}{20}\sum_{i=0}^{19}\text{Float-weighted turnover}_{t-i}
$$

- A higher value means trading has recently been more active.
- A lower value means trading has been relatively quiet.
- It is not upward momentum. A falling market with heavy volume can also have high activity.

## Market breadth

The page averages the percentage of stocks above their 20-day and 60-day moving averages:

$$
\text{Breadth}
=
\frac{\text{Above MA20 ratio}+\text{Above MA60 ratio}}{2}
$$

If 40% of stocks are above MA20 and 20% are above MA60, breadth is 30%.

- Higher breadth means more stocks are above both short- and medium-term reference levels.
- Lower breadth means improvement is concentrated in fewer stocks.
- Breadth is not the day's advancing-stock ratio. **Advancing today** describes only one session.

## Trend strength

Trend strength is the return over the latest 20 trading days:

$$
\text{Trend}_t
=
\frac{P_t}{P_{t-20}}-1
$$

- All A-shares aggregates equal-weighted returns calculated from adjusted stock prices.
- An index scope uses official index closes.

A positive value means the current level is above its level about 20 trading days earlier. It describes a completed change and does not forecast the next 20 days.

## Trading crowding

Crowding is the share of total trading amount contributed by the highest-amount 5% of stocks:

$$
\text{Crowding}
=
\frac{\text{Amount from the top 5\% of stocks}}{\text{Total amount in the scope}}
$$

A higher value means trading is more concentrated in a small number of stocks. It does not mean those stocks rose or that the entire market lacks liquidity.

## Read the metrics together

The numbered areas are:

1. Scope and data date.
2. Current value, description, and three-year percentile for each metric.
3. Moving-average, advance, limit, and trading-amount details.
4. Metric selector and history.
5. Calculation method.

![Market metric cards and history](/docs/images/help/zh/market-valuation/market-overview-01.png)

Use specific descriptions instead of saying that the market is simply “good”:

- High activity and high breadth: trading is active and many stocks are above their moving averages.
- High activity and low breadth: trading is active but concentrated in fewer stocks.
- Positive trend and high crowding: the scope rose over 20 days, with trading concentrated in fewer names.
- Negative trend and many stocks advancing today: a one-day rebound has not offset the 20-day change.

These remain descriptions of historical state, not trading instructions.

## Use the three-year history

1. Switch among the four metrics above the chart.
2. Look for earlier periods near the current value.
3. Compare the chart with the three-year percentile in the metric card.
4. Drag the lower zoom control to inspect a shorter interval.

A percentile compares the same metric and scope across valid trading days in the latest three years. A CSI 300 percentile of 90% is not directly interchangeable with a 90% value from another metric or scope.

## Common mistakes

- Treating high activity as bullish.
- Treating one day with many advancing stocks as a lasting breadth improvement.
- Assuming high crowding must reverse immediately.
- Combining the four values into an undocumented personal score.
- Comparing values without checking scope and data date.

## Related articles

- [View the Market page and change scope](/docs/help/market-valuation/market-overview)
- [Interpret historical percentiles correctly](/docs/help/market-valuation/percentiles)
- [Why a backtest is not a future return](/docs/help/basics/backtest-limitations)
