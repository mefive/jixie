# Run ETF time-series research

Time-series research compares one asset across its own historical states. It asks whether a higher or lower signal for an ETF is related to that ETF's future return, rather than ranking several assets on the same date.

## Create or select a study

1. Open Factor research.
2. Select ETF time-series signal, or create a Factor with that research method.
3. For a custom study, enter its name and immutable Factor key.
4. Choose research assets, forward horizon, and dates.
5. Click Run analysis and complete the research card.

The numbered areas are the research method, assets, horizon and dates, and run action.

![ETF time-series definition and settings](/docs/images/help/zh/factors/time-series-research-01.png)

The target is total return over the selected number of future trading days. Both signal and target dates require actual data. Missing history or a missing target date is skipped rather than filled with zero.

## Read per-asset evidence

The report shows correlation, regression slope, Newey–West t-statistic, directional hit rate, and returns in positive and negative signal states.

The simple regression is:

$$
r_{t\rightarrow t+h}=\alpha+\beta f_t+\varepsilon_t
$$

The displayed slope is \(\beta\). A larger absolute t-statistic indicates a clearer in-sample estimate relative to noise, not guaranteed persistence. Testing many assets and horizons also creates multiple-testing risk.

![Per-asset evidence and state returns](/docs/images/help/zh/factors/time-series-research-02.png)

## Input boundaries

- Adjusted ETF closes and approved government-yield inputs can be used by controlled definitions; official curves become available on the next SSE trading day.
- Commodity Carry is derived from actual monthly contracts while future returns come from mapped ETFs. Metals and energy-chemical ETFs are not one-to-one copper and crude-oil proxies.
- Warehouse-receipt research currently allows gold, copper, and soybean meal. Crude oil is excluded because tonne and barrel series cannot be audited as one measure.
- If Publication and strategy reference is absent, the template is research-only. Do not bypass the restriction by copying code.

## From exploration to publication

An eligible time-series Factor still needs a research card, exploration, and a sealed holdout. Publication is available only when the page exposes the action and the report passes its gates. Controlled Carry and warehouse-receipt templates cannot currently be published, deployed, or used in Today signals.

## Related articles

- [Research card, exploration, and holdout](/docs/help/factors/research-card)
- [Holdout and out-of-sample results](/docs/help/factors/holdout-results)
- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)
