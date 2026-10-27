# Run ETF time-series research

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Time-series research compares one asset across its own historical states. It asks whether a higher or lower signal for an ETF is related to that ETF's future return, rather than ranking several assets on the same date.

## Create or select a study

1. Open Factor research.
2. Select ETF time-series signal, or create a Factor with that research method.
3. For a custom study, enter its name and immutable Factor key.
4. Choose research assets, forward horizon, and dates.
5. Choose assets, dates and forward horizon, then run directly. Publication requires a successful report matching the source.

The numbered areas are the research method, assets, horizon and dates, and run action.

![Historical Chinese UI example: ETF time-series definition and settings](/docs/images/help/zh/factors/time-series-research-01.png)

The target is total return over the selected number of future trading days. Both signal and target dates require actual data. Missing history or a missing target date is skipped rather than filled with zero.

## Read per-asset evidence

The report shows correlation, regression slope, Newey–West t-statistic, directional hit rate, and returns in positive and negative signal states.

The simple regression is:

$$
r_{t\rightarrow t+h}=\alpha+\beta f_t+\varepsilon_t
$$

The displayed slope is \(\beta\). A larger absolute t-statistic indicates a clearer in-sample estimate relative to noise, not guaranteed persistence. Testing many assets and horizons also creates multiple-testing risk.

![Historical Chinese UI example: Per-asset evidence and state returns](/docs/images/help/zh/factors/time-series-research-02.png)

## Input boundaries

- Adjusted ETF closes and approved government-yield inputs can be used by controlled definitions; official curves become available on the next SSE trading day.

Futures carry and warehouse-receipt fields and templates are retired; rerunning old code fails. Adjusted-price research on commodity or gold ETFs remains available.

## From exploration to publication

Choose assets, dates and forward horizon, then run directly. Publication requires a successful report matching the source.

## Related articles

- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)
