# Read your first factor analysis result

After the run completes, verify the sample and methodology before reading the group chart and metrics. Do not start with a single return number.

## Verify the methodology first

The numbered areas are:

1. Effective periods, years, equal- or market-cap weighting, and factor direction.
2. Research methodology and reproducibility.

![Sample range and methodology in a factor report](/docs/images/help/zh/factors/factor-methodology-01.png)

Check the following in order:

1. **Periods and years**: confirm that they match the selected range. “120 months” means 120 valid monthly observations.
2. **Data cutoff**: the latest date actually used by the report. It may not be today.
3. **Effective periods**: compare the periods analyzed with the periods considered.
4. **Sample stages**: inspect the before and after counts for factor values, formation and forward quotes, listing age, risk status, and liquidity.
5. **Method**: verify listing age, liquidity drop, minimum candidates, outlier treatment, and costs.
6. **Yellow notice**: if a historical status cannot be applied reliably, the report identifies it and does not backfill the past using today's status.

The code SHA-256 is a digest of the factor implementation used for this report. It helps identify whether two reports used the same implementation; you do not need to calculate it manually.

## Read the group chart

The numbered areas are:

1. Next-period annualized return for D1 through D10.
2. The chart definition.
3. Main statistics.

![Decile returns and main metrics in a factor report](/docs/images/help/zh/factors/factor-overview-01.png)

On the horizontal axis:

- D1 contains the stocks with the lowest factor values.
- D10 contains those with the highest values.
- The vertical axis annualizes each group's subsequent-period return.

Look at the full sequence before comparing only D1 with D10. A reasonably gradual progression across the groups is stronger historical evidence of a ranking relationship than a noisy middle with only an extreme difference at the endpoints.

A negative bar does not by itself make the factor invalid. Compare the relative order, consistency across periods, costs, and drawdown.

## Metrics to understand first

- **Mean Rank IC**: in each period, correlate the factor ranking with the next-period return ranking, then average the correlations. A positive value means higher factor rankings were generally followed by higher return rankings. A larger absolute value indicates a stronger historical ranking relationship.
- **Annualized ICIR**: the mean Rank IC relative to its variability. A higher number indicates more historical consistency, not guaranteed persistence.
- **IC > 0 rate**: the share of periods in which the direction was positive. A value near 50% indicates weak directional consistency.
- **Long-short D10−D1 annualized**: the historical difference from a hypothetical long position in the highest group and short position in the lowest group. This is a research construction, not necessarily executable in a regular account.
- **Long-short Sharpe**: long-short return relative to its variability. Read it together with maximum drawdown.
- **Long-short maximum drawdown**: the largest decline from a previous peak in the long-short curve.
- **Top-group monthly turnover**: the share of names replaced in the highest group each month. Higher turnover normally means greater costs and execution difficulty.

The values in the screenshots change as data and settings change. Your result does not need to match them exactly.

## Recommended reading order

1. Verify the factor, frequency, dates, and neutralization.
2. Verify the data cutoff and effective sample.
3. Check whether D1 through D10 form a reasonably ordered sequence.
4. Read the sign and magnitude of mean Rank IC.
5. Use IC > 0 rate and ICIR to judge historical consistency.
6. Check long-short maximum drawdown and top-group turnover.
7. Continue to the gross-versus-net curve to inspect cost impact.
8. Run a reasonable alternative range or neutralization setting to see whether the conclusion depends on one specification.

## Do not trade from one report

Before using a factor, check:

- Whether many factors and parameter combinations were tried before selecting the best result.
- Whether an out-of-sample period was kept separate from tuning.
- Whether any historical filters could not be executed.
- Whether the long-short construction relies on shorting that may not be available.
- Whether the result remains after costs.
- Whether the factor is concentrated in a few industries or small companies.

## Related articles

- [What factor research can answer](/help/factors/what-factor-research)
- [Set the analysis range and sample treatment](/help/factors/analysis-settings)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
