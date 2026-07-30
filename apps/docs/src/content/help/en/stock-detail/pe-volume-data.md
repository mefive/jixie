# Read PE, volume, and data dates

Stock detail displays price, PE, and volume together. They have different meanings and axes, so their screen heights cannot be compared directly.

## Read PE

![Candlesticks, PE, volume, and time range](/docs/images/help/zh/stock-detail/chart-overview-01.png)

The blue line in the upper chart is PE:

- It uses the blue axis on the right.
- Candlestick price uses the Price axis on the left.
- Move the pointer to one date to inspect price and PE together.

PE can rise because price rises or earnings fall. It can fall because price falls or earnings rise. The PE line alone does not identify the cause.

When earnings are negative or valid data is missing, PE may be unavailable. A gap is not a PE of zero.

## Read volume

The red and green bars below are volume:

- Red corresponds to a close at or above the open.
- Green corresponds to a close below the open.
- Bar height compares trading activity for the same stock across dates.

High volume means more activity. It does not by itself predict the next price move.

## Use the time-range slider

The slider controls candlesticks, PE, and volume together, keeping them aligned by date.

To inspect an unusual period:

1. Narrow the range around the date.
2. Move the pointer to that date.
3. Record price, PE, and volume together.
4. Expand the range again to see the longer-term context.

## Verify the data date

1. Read the rightmost date.
2. Confirm it is the expected latest trading day.
3. If it is earlier, consider a non-trading day or an incomplete update.
4. Do not interpret missing future dates as an unchanged price.

When sharing a chart, include the security code, adjustment, scale, and data end date.

## Common misunderstandings

### The PE line is above the candlesticks, so PE is greater than price

That comparison is invalid. PE and price use different axes.

### A high volume bar is a buy signal

Volume is not a trade conclusion. Consider price direction, date, market context, and the trading rule.

## Related articles

- [Read Stock detail and candlesticks](/help/stock-detail/read-chart)
- [Switch adjustment and price scale](/help/stock-detail/adjustments-scale)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
