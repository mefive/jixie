# Read macro-regime research

The macro-regime model turns manufacturing PMI, CPI year-on-year, and PPI year-on-year into continuous growth and inflation axes, then labels four states. It compares future ETF returns across states but does not set portfolio weights.

## Configure the study

1. Open Factor research.
2. Select Macro regime models.
3. Choose conditional-return assets, horizon, and dates.
4. Choose Latest-value backfill (exploration only) or As available (PIT).
5. Click Run analysis. The current frozen model is exploratory and does not ask for a directional admission criterion.

Each axis combines level and three-month change, standardized with only visible history over a 60-month rolling window. Positive and negative axes form strong-growth/high-inflation, strong-growth/low-inflation, weak-growth/high-inflation, and weak-growth/low-inflation states.

![Assets, horizon, and revision policy for macro research](/docs/images/help/zh/factors/macro-regime-01.png)

## Revision policies

- **Latest-value backfill** provides longer history using currently available final values. It can include revisions unknown at the decision date. The report discloses future revisions and cannot be published.
- **As available (PIT)** uses only vintages captured by that decision date. Earlier local history can be sparse or empty, but this is the strict time-correct policy.

Delaying today's final value by a publication date does not recreate a historical vintage if that value was revised later.

## Read the four-state report

The header shows valid months, asset observations, state transitions, skipped months, cutoff, and PIT status. Each state shows months, episodes, average and maximum duration, mean future return, Newey–West mean t-statistic, positive-return rate, and the result using the previous month's state.

![Four macro states, conditional returns, and revision warning](/docs/images/help/zh/factors/macro-regime-02.png)

If contemporaneous and lagged-state results point in different directions, the conclusion is timing-sensitive. Do not retain only the better column.

## Current limits

The current model does not expose publication or Use in Strategy Lab. State labels are not orders or fixed stock/bond/gold weights. Mapping states to positions requires a separate strategy, rebalance rule, risk constraints, and backtest. Latest-value results cannot bypass the future-revision warning.

## Related articles

- [Why a backtest is not a forecast](/docs/help/basics/backtest-limitations)
- [Research card, exploration, and holdout](/docs/help/factors/research-card)
- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
