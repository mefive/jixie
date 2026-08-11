# Run cross-asset Panel research

Panel research ranks several ETFs at each common month-end and compares those ranks with subsequent return ranks. It tests cross-asset selection evidence; it is not an executed allocation strategy.

## Run a Panel Factor

1. Open Factor research.
2. Select a preset under Panel cross-sectional factors, or create one with that method.
3. Verify the fixed research universe, holding horizon, and date range.
4. Click Run analysis and complete the research card.
5. Wait for the Panel report.

The universe covers domestic and overseas equity, several government-bond durations, gold, and commodity ETFs. Each ETF enters only after listing and after sufficient history exists.

![Fixed Panel universe and settings](/docs/images/help/zh/factors/panel-research-01.png)

## Read Panel ranking evidence

For each month-end:

$$
IC_t=\operatorname{Corr}_{Spearman}\left(\operatorname{Rank}(F_{i,t}),\operatorname{Rank}(r_{i,t\rightarrow t+h})\right)
$$

The report shows mean Rank IC, annualized ICIR, positive-IC rate, equal-weight baseline, net long-short annualized return, and one-way turnover.

- The equal-weight baseline describes the universe without the signal.
- The diagnostic long-short portfolio selects the top and bottom 25% and deducts 10bp one-way cost.
- A live-style strategy is usually long-only with cash and fill constraints. Do not compare the two as if they were identical portfolios.

## Within-class and between-class evidence

Within-class Rank IC compares ETFs inside an asset class. Between-class evidence first compresses each class into an equal-weight representative, then ranks classes. This prevents a class with more ETFs from receiving more votes.

![Panel ranking, class decomposition, and listing coverage](/docs/images/help/zh/factors/panel-research-02.png)

These are diagnostics. They do not rewrite the Factor score or replace the pre-registered holdout criterion.

## Check coverage

Asset coverage lists each ETF's observations and first and last valid month-end. The report also shows minimum, median, and maximum assets per period. Late listings remain visibly shorter.

## Create a Panel composite

1. Click New composite.
2. Choose Panel cross-sectional as the research method.
3. Select two to five components, directions, and Rank or Z-score standardization.
4. Keep the fixed equal-weight rule through exploration and holdout.
5. Before publishing, confirm every component is itself published.

A published Panel composite can enter Strategy Lab. Its allocation attribution is separate from the research long-short result.

## Related articles

- [Create a multi-factor composite](/docs/help/factors/create-composite)
- [Read a composite report](/docs/help/factors/read-composite-report)
- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)
- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
