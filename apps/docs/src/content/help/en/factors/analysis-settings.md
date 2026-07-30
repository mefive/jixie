# Set the analysis range and sample treatment

You can keep the defaults for your first run. When comparing reports, record and verify every setting instead of comparing only the final return.

## Open analysis settings

1. Select a factor in **Factor Research**.
2. Select **More settings** in the upper-right.
3. Wait for the **Analysis settings** panel.

The numbered areas are:

1. Rebalance frequency.
2. Analysis date range.
3. Neutralization.
4. The universe and missing-data section.
5. Universe, coverage, and risk-status settings.
6. Outlier treatment.

![Frequency, range, neutralization, and sample settings](/docs/images/help/zh/factors/factor-settings-01.png)

## Frequency

- **Monthly**: compare the factor and subsequent return once per month. This is a good first setting because it is easier to read and normally has lower turnover than weekly analysis.
- **Weekly**: compare them once per week. It provides more periods but is more exposed to short-term noise and turnover.

Frequency changes the rebalance dates, forward-return horizon, and turnover calculation. Run the analysis again after changing it.

## Date range

The range determines which historical observations are used. As a starting point:

1. Use several years that contain different market conditions.
2. Do not keep moving the dates only because another range looks better.
3. Use the same range when comparing two factors.
4. Check the report's data cutoff instead of assuming the data runs through today.

A short monthly range contains few observations, so one extreme month can have a large effect.

## Neutralization

- **None**: compare the raw factor values. Use this for the first run.
- **Size**: reduce the effect of differences in market capitalization.
- **Size + industry**: control for both market capitalization and industry.

For example, a factor may favor small companies during a period when small companies generally perform well. Neutralization helps test whether the relationship remains after controlling for that shared size exposure.

Neutralization is not a switch for improving a result. Keep and compare both reports instead of retaining only the better one.

## Universe and missing data

- **Minimum listing days** excludes recently listed stocks.
- **Drop low liquidity** removes the least liquid portion in each period.
- **Minimum candidates** rejects a period with too few eligible stocks.
- **Minimum window coverage** requires sufficient observations for factors that use a historical window.
- **Exclude ST / risk warning** removes stocks carrying that status at the time.
- **Exclude pending delisting** removes stocks in the delisting arrangement period at the time.

These settings determine which stocks can enter each period. Keep the defaults for the first run, and do not disable risk-status filters merely to increase the sample.

## Outlier treatment

A small number of extremely large or small values can materially affect the statistics. The page treats factor exposures and forward returns separately.

**Winsorize 1%** limits the influence of the two tails without removing all variation. **MAD clipping** identifies unusual values using the sample median and dispersion. Use the same treatment when comparing reports.

## Trading costs

Commission, sell-side stamp duty, and slippage are set per side. They mainly affect the net long-short result. Their effect is normally larger when the analysis is more frequent or the top group has high turnover.

Do not set all costs to zero and treat the gross result as achievable.

## Finish the settings

1. Select **Run analysis** at the bottom of the panel, or close the panel and use the action at the top.
2. Complete the pre-run research card.
3. Wait for the new report.
4. Recheck frequency, dates, and neutralization at the top.
5. Verify the universe, outlier, and cost definitions in the methodology card.

## Related articles

- [Run your first preset factor analysis](/help/factors/first-preset-analysis)
- [Read your first factor analysis result](/help/factors/results-overview)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
