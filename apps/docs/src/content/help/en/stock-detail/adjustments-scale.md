# Switch adjustment and price scale

Dividends, bonus shares, rights issues, and splits can create jumps in historical prices. Adjustment improves comparability across those events. It changes the displayed series, not the prices at which trades actually occurred.

## Switch adjustment

![Stock detail using after-adjustment and a logarithmic scale](/docs/images/help/zh/stock-detail/adjustments-01.png)

Adjustment is marked **1**.

| Option | Display | Useful for |
| --- | --- | --- |
| Forward-adjusted | Historical prices anchored to the latest price | Continuity between history and the current price |
| After-adjusted | Adjustments accumulated forward from history | Long periods including distributions and share changes |
| Unadjusted | Recorded historical prices | Checking actual quotes around ex-right and ex-dividend dates |

Steps:

1. Select Forward-adjusted, After-adjusted, or Unadjusted.
2. Wait for the chart to redraw.
3. Check the left price-axis values.
4. Keep the same period when comparing shapes.

Do not mix absolute values from different adjustment modes. The latest after-adjusted value may not equal the actual traded price.

## Linear and logarithmic scales

The price scale is marked **2**.

### Linear

Equal vertical distance represents an equal price difference. A CNY 10 move has similar height whether it is from 10 to 20 or from 100 to 110.

Useful for shorter periods and absolute price changes.

### Logarithmic

Equal vertical distance more closely represents an equal percentage change. It is useful when a long history spans a wide price range.

Useful for long periods, relative changes across price levels, and changes in long-term growth rate.

A logarithmic scale requires positive prices. It does not change the market data or return; it only changes the axis.

## A consistent comparison

1. Keep the same time period.
2. Switch adjustment and inspect jumps around corporate actions.
3. Fix adjustment, then switch between linear and logarithmic.
4. Record both settings when sharing an observation.

## Common misunderstandings

### A high after-adjusted price was an actual traded price

No. It is a calculated display value for historical comparability.

### Forward adjustment includes every real investment cost

No. It treats price-series discontinuities. It does not include commissions, taxes, or an investor's actual transaction times.

## Related articles

- [Read Stock detail and candlesticks](/help/stock-detail/read-chart)
- [Read PE, volume, and data dates](/help/stock-detail/pe-volume-data)
