# Understand Market Weather cards

Each card displays period return, heat, activity, breadth, and valuation position. These answer different questions; no single number is a trading signal.

## Main information on a card

![Return and state metrics on Market Weather cards](/docs/images/help/zh/market-valuation/market-weather-overview-01.png)

- **Period return**: price change for the selected week, month, quarter, or year, using the corresponding official industry or index series.
- **Relative return**: a style or strategy index's return minus its labeled parent index over the same period. It is hidden when no reliable parent is available.
- **Heat**: a combined view of trend, breadth, and activity.
- **Activity**: the current turnover level within its own latest three-year history.
- **Breadth**: how many constituents participate in the stronger state rather than a few names driving it.
- **Valuation badge**: the PE or PB position within its own history, separate from the card background.
- **Heat change**: change from the preceding snapshot of the same period.

The page follows the mainland China convention of red for gains and green for losses. The card background represents weather heat, not valuation; valuation appears separately below the card.

## How heat is composed

The directional heat score equally combines the three visible components:

$$
\text{Directional heat}
=
\frac{\text{Trend score}+\text{Breadth score}+\text{Activity score}}{3}
$$

- Trend compares period performance across cards in the same dimension.
- Breadth describes participation among the card's constituents.
- Activity compares current turnover with the card's own latest three-year history.

The weights were not optimized for future returns. A high heat score means several current conditions are strong or active at the same time; it does not mean the next period will rise.

## The seven page states

| State | Historical condition expressed by the page | It does not mean |
| --- | --- | --- |
| Undervalued | Valuation is relatively low but trading conditions have not clearly warmed | A bottom is certain |
| Warming | Trend, breadth, or activity has begun to improve | An uptrend is confirmed |
| Expanding | Performance is strong with broader participation | Valuation and risk can be ignored |
| Overheated | Current heat is in a high region | An immediate reversal |
| Crowded | Strong performance is accompanied by concentrated trading | You must sell now |
| Cooling | Performance, breadth, or activity has weakened | Prices must keep falling |
| Balanced | No other pronounced state applies | There is no risk or opportunity |

State labels help you locate cards quickly. Read the component values and their history before drawing a conclusion.

## Industry cards and index cards

Industry cards use 31 official SW level-one industry indices and supplement them with constituent breadth and activity. PE and PB use the official SW industry definition when available.

Size, board, and style cards use official index closes for return. Breadth and activity use historical constituent snapshots that were available by the observation date. Valuation prefers an official index series and uses constituent aggregation only when the official series is unavailable.

The page never fills all historical periods with today's constituents. An early card may therefore have return data but no breadth or valuation; that is an intentional data boundary.

## Compare cards correctly

1. Compare horizontally only within the same dimension and period.
2. Check the snapshot date and any missing metric.
3. Read return with breadth to distinguish broad participation from a move driven by a few constituents.
4. Keep activity separate from return direction; a selloff can also be highly active.
5. Treat valuation as independent context rather than a substitute for trend.
6. Replay several periods instead of deciding from the latest card alone.

## Common mistakes

- Reading heat 80 as an 80% probability of rising.
- Treating an undervalued badge as an immediate rise.
- Assuming high activity means money must keep flowing in.
- Comparing a weekly return with a yearly return.
- Ignoring the parent index used for relative return.
- Reading only color without the snapshot date and component metrics.

## Related articles

- [View the Market Weather map](/docs/help/market-valuation/market-overview)
- [Replay history and inspect card details](/docs/help/market-valuation/weather-playback)
- [Interpret historical percentiles correctly](/docs/help/market-valuation/percentiles)
- [Why a backtest is not a forecast](/docs/help/basics/backtest-limitations)
