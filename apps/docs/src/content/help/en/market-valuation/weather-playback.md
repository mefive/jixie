# Replay history and inspect card details

The Market Weather page loads the history for the current dimension and period at once. Moving the timeline only selects an existing snapshot; it does not rerun a market-wide calculation.

## Use the timeline

The numbered controls are:

1. Previous period.
2. Play or pause.
3. Next period.
4. Draggable historical timeline.
5. Earliest, selected, and latest periods.

![Market Weather replay controls](/docs/images/help/zh/market-valuation/market-weather-playback-01.png)

1. Select a dimension and a weekly, monthly, quarterly, or yearly period.
2. Select **Previous** one period at a time, or drag the slider to a date.
3. Select **Play** to advance from the current point.
4. Pause when you need to inspect a period carefully.
5. Return to the far right for the latest available period.

After the latest period, playback restarts from the earliest one. Playback changes only the selected page state; it neither changes data nor saves a personal setting.

## Compare cards in fixed positions

Within one dimension, groups and card positions remain fixed. During replay, follow the same position to avoid a visual comparison distorted by re-sorting each period.

Ask one question at a time, for example:

- How many periods did an industry take to move from **Warming** to **Expanding**?
- Did large-cap core indices warm at the same time as small caps?
- Did a style index's absolute and parent-relative returns move in the same direction?
- Did heat stay high after its valuation badge reached a high position?

These observations describe a historical path. They do not establish a tradable rule.

## Open card details

1. Select a card.
2. The detail panel opens on the right.
3. Check current state, period return, and relative return.
4. Review heat, activity, breadth, and valuation.
5. Inspect up to 24 recent periods in the color strip and record list.
6. Close the panel to return to the card wall.

![Market Weather metrics and history in card details](/docs/images/help/zh/market-valuation/market-weather-detail-01.png)

**Official valuation** comes from an official daily industry or index series. **Constituent valuation** is a proxy aggregated from constituents and weights available at that time. Do not treat these sources as identical series.

## Choose week, month, quarter, or year

- Start with week or month for recent changes.
- Use quarter or year to check persistence.
- Do not search several periods after seeing the results and present the most attractive one as a preselected test.
- To convert an observation into a strategy condition, write an explicit rule and backtest it separately instead of trading directly from card color.

## Common questions

### Why does the timeline start relatively late?

An index may have launched later, or early official quotes and constituents may be unavailable. The page shows periods that can be calculated reliably and does not fabricate pre-launch history.

### Why do details contain fewer than 24 periods?

The card may have fewer valid points, or the selected date may be near the start of the series. The page shows the observations actually available.

### Why does changing the dimension return to the latest period?

Different dimensions can have different start dates. After changing the dimension or period, the page selects the latest available snapshot for that series.

## Related articles

- [View the Market Weather map](/docs/help/market-valuation/market-overview)
- [Understand Market Weather cards](/docs/help/market-valuation/market-metrics)
- [View index valuation](/docs/help/market-valuation/index-valuation)
