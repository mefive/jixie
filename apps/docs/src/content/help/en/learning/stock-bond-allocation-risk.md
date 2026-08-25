# Stock-bond allocation and risk attribution: contributions, correlation, and stress scenarios

> Learning path · About 90–120 minutes · Complete one Panel Factor analysis and one multi-asset backtest first.

This exercise asks a question that an equity curve can hide: **where did the return and risk of a stock-bond rotation actually come
from, and did it become a better strategy after reducing drawdown?** You will create a stock-and-bond Panel Factor with no gold or
commodity ETFs, use it for a monthly rotation among the CSI 300, 5-year CGB, and 10-year CGB ETFs, then audit return contribution,
risk contribution, correlation, rate regimes, market risk, and stress scenarios.

This is not an allocation recommendation. The real run deliberately retains a result with much smaller drawdown but inferior return,
so the exercise cannot be passed by selecting the most flattering risk statistic.

## The fixed case was run end to end

On 2026-08-25, a fresh account ran the Panel report, publication, two backtests, and the complete risk attribution through the real
product API, job queue, Python sandbox, and browser UI. The screenshots on this page came from that run. The strategies were deleted
and the temporarily published Factor was archived after acceptance.

| Item | Frozen setting |
| --- | --- |
| Factor | `stock_bond_momentum_120`, 120-day adjusted-price momentum |
| Factor asset domain | `equity` and `fixed_income`; `commodity` explicitly excluded |
| Panel research universe | 9 domestic-equity ETFs, 3 overseas-equity ETFs, and 3 CGB ETFs; no gold or commodity ETF |
| Strategy watchlist | `510300.SH`, `511010.SH`, and `511260.SH` |
| Rebalance rule | Rank monthly by the Factor and equally weight the top two |
| Baseline | 95% buy-and-hold in `510300.SH` |
| Range | 2018-01-01 through 2026-07-30; Factor explore data ended 2025-01-27 |
| Costs | CNY 1 million; 2bp slippage; impact coefficient 0.1 |

### Actual Panel evidence

The explore report contained 83 valid months and 976 observations. Mean Rank IC was **0.0181**, annualized ICIR was 0.13, and
54.22% of Rank IC observations were positive. Yet equal-weight long-short annualized return was -7.44%, cost-adjusted long-short
annualized return was **-8.25%**, and average one-way turnover was 36.35%.

![Actual Panel report whose asset domain contains only equities and fixed income](/docs/images/help/zh/learning/stock-bond-panel-factor-result.png)

Rank IC barely exceeded the preregistered directional floor of `> 0`; that does not establish economic value. Long-short performance
was negative and costs made it worse. The Factor was published temporarily to freeze its code, report, and asset taxonomy and exercise
the attribution workflow—not because it qualified as a production Factor.

### Actual baseline and rotation results

| Run | Total return | Annual return | Max drawdown | Sharpe | Annual turnover | Trades | Fees | Slippage loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 95% CSI 300 ETF buy-and-hold | 28.84% | 3.12% | -40.72% | 0.258 | 0.05× | 1 | CNY 237.50 | CNY 360.96 |
| Monthly stock-bond momentum | 3.10% | 0.37% | -13.27% | 0.088 | 1.89× | 155 | CNY 8,032.40 | CNY 76,609.55 |

![Actual CSI 300 ETF buy-and-hold baseline](/docs/images/help/zh/learning/stock-bond-baseline-result.png)

![Actual costed stock-bond momentum result](/docs/images/help/zh/learning/stock-bond-allocation-result.png)

The rotation reduced maximum drawdown from -40.72% to -13.27%, but total return, annual return, and Sharpe all trailed the baseline.
Its CNY 76.6 thousand slippage loss also dwarfed the baseline cost. The fixed verdict is: **historical defensive behavior was present,
but neither return nor risk-adjusted outperformance was established; this is not a production candidate.**

### Actual attribution and risk diagnostics

Portfolio P&L of CNY 30,998 reconciled exactly to attributed P&L, with a near-zero residual.

| Asset class | Average weight | Return contribution | Risk contribution | Net P&L |
| --- | ---: | ---: | ---: | ---: |
| Fixed income | 68.38% | +9.72% | 6.89% | +CNY 97,200 |
| China equity | 24.50% | -6.62% | 93.11% | -CNY 66,202 |
| Overseas equity | 0.00% | 0.00% | 0.00% | CNY 0 |

![Actual reconciliation of return and risk contributions](/docs/images/help/zh/learning/stock-bond-attribution-result.png)

Average weight is not risk contribution. China equity averaged only 24.50% of NAV but contributed 93.11% of portfolio risk; fixed
income had the larger average weight and only 6.89% of risk. A “60/40” label or average allocation cannot tell this story by itself.

The latest 60-day China-equity/fixed-income correlation was **0.1520** on 2026-07-30. The page also retains 60- and 120-day windows
and month-end rolling paths; one low-correlation observation is not a permanent relationship.

![Actual rolling stock-bond asset-class correlation](/docs/images/help/zh/learning/stock-bond-correlation-result.png)

The latest rate regime was “rates falling / curve steep.” Across the 879 historical trading days classified into that state, the
fixed-income asset-class annualized mean was 6.26% and China equity was 1.42%. This is a conditional historical review, not a forecast.

![Actual conditional asset-class performance by rate regime](/docs/images/help/zh/learning/stock-bond-rate-regime-result.png)

The market-risk diagnosis used 252 of 252 daily observations, estimated 9.93% annualized portfolio volatility, and reported 91.66%
explained variance. China equity accounted for 99.14% of variance-contribution share. The standard risk model still displays gold and
commodity drivers even though this case held no gold, traded no commodity ETF, and excluded them from Panel research. Those rows are
regression explanatory variables—not holdings or research-universe members.

![Actual portfolio market-risk diagnosis](/docs/images/help/zh/learning/stock-bond-market-risk-result.png)

Under the current linear exposures, a 10% A-share decline estimated -4.48%, a 50bp CGB-yield rise estimated -1.24%, and cross-asset
risk-off estimated -3.18%. The 2022 global-inflation replay estimated -11.60%, the worst of the three historical scenarios.

![Actual stress-scenario estimates under current exposures](/docs/images/help/zh/learning/stock-bond-scenarios-result.png)

## What you will be able to do

After completing the exercise, you should be able to:

1. separate the Panel research universe, strategy watchlist, and risk-model drivers;
2. create a Panel Factor restricted to equity and fixed-income ETFs and verify its frozen report;
3. build a comparable buy-and-hold baseline with identical dates, capital, and costs;
4. reconcile return, cost, and risk contribution at both asset and asset-class levels;
5. interpret rolling correlation, rate regimes, market/macro risk, and stress scenarios correctly; and
6. reject a candidate when drawdown improves but return, Sharpe, and costs do not qualify.

## Step 1: separate three asset scopes

| Scope | This case | Purpose |
| --- | --- | --- |
| Factor asset domain | `equity`, `fixed_income` | Constrains the broad classes for which the definition may emit scores |
| Frozen Panel universe | 12 equity ETFs and 3 CGB ETFs | Produces ranking evidence and an auditable taxonomy |
| Strategy watchlist | CSI 300, 5-year CGB, and 10-year CGB ETFs | Determines the three assets the strategy can actually trade |

A static multi-asset strategy can be backtested, but without an approved Panel report the system lacks an authoritative asset-class
taxonomy and does not produce complete allocation attribution. Publishing the Panel Factor lets the backtest inherit its frozen
taxonomy and code lineage.

## Step 2: create a stock-bond-only Panel Factor

In Factors, choose “New → Panel cross-sectional Factor,” set key `stock_bond_momentum_120`, and use:

```python
from jixie import Factor, AssetFactorContext

factor = Factor.panel(
    name="Stock-bond momentum 120d",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income"],
    window=121,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 120)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
```

Do not add `commodity`. After saving or reopening the Factor, the page should restore only the equity and fixed-income domains and
must not silently append gold or commodity ETFs.

Before running the monthly Panel report, write a positive Rank IC hypothesis, mechanism limitations, and the primary criterion
`panel_rank_ic_mean > 0`. Read Rank IC, ICIR, positive rate, long-short return, and turnover together. In this case, the -8.25%
cost-adjusted long-short result prevents 0.0181 Rank IC from becoming a success claim.

## Step 3: publication freezes lineage; it does not certify efficacy

Publication is available only when the report is complete, code is unedited, and the research draft matches the frozen report. A
strategy can then reference the exact definition by key, while the backtest records Factor ID, code hash, inputs, and approved report.

This exercise permits temporary publication solely to teach allocation attribution. Publication is not investment-committee approval
and cannot override negative cost-adjusted evidence. Archive the Factor when the exercise is complete.

## Step 4: build the comparable baseline

```ts
const equity = '510300.SH';

export default defineStrategy({
  name: 'Learning case: CSI 300 ETF buy-and-hold baseline',
  watch: [equity],
  onBar(ctx) {
    if (ctx.price(equity) != null && ctx.shares(equity) === 0) {
      ctx.orderTargetPercent(equity, 0.95);
    }
  },
});
```

Use 2018-01-01 through 2026-07-30, CNY 1 million, and identical costs for both runs. Otherwise returns and drawdowns are not directly
comparable.

## Step 5: run monthly stock-bond rotation

```ts
const equity = '510300.SH';
const bond5y = '511010.SH';
const bond10y = '511260.SH';
const assets = [equity, bond5y, bond10y];
let lastMonth = '';

export default defineStrategy({
  name: 'Learning case: stock-bond momentum 120d monthly rotation',
  watch: assets,
  factors: ['stock_bond_momentum_120'],
  onBar(ctx) {
    const month = ctx.period('monthly');
    if (month === lastMonth) return;
    lastMonth = month;
    const picks = assets
      .map(code => ({ code, score: ctx.factor('stock_bond_momentum_120', code) }))
      .filter(item => item.score != null)
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      .slice(0, 2)
      .map(item => item.code);
    if (picks.length === 2) ctx.equalWeight(picks);
    else ctx.setHoldings({});
  },
});
```

Verify lineage, 155 trades, 103 rebalances, fees, and slippage. A low-frequency label does not prove low cost; actual slippage consumed
about 7.66% of initial capital.

## Step 6: read allocation analysis in order

1. **Asset classes:** reconcile portfolio and attributed P&L before comparing weight, return, and risk contribution.
2. **Assets:** verify that only the three strategy assets have nonzero positions; the rest of the research universe stays at zero.
3. **Correlation:** compare 60- and 120-day windows and rolling paths, not only the latest value.
4. **Rate regime:** describe state results as historical conditions, not predictions.
5. **Risk research:** keep daily market risk separate from monthly macro sensitivity and verify lineage.
6. **Stress scenarios:** state that results are linear current-exposure estimates without rebalancing, liquidity shocks, or nonlinear paths.

Risk contribution allocates component/portfolio covariance. It may be much larger than average weight and can be negative. Return and
risk contribution answer different questions and are not interchangeable.

## Step 7: write the verdict

```text
Research verdict: do not advance to a production candidate.

Evidence: Panel Rank IC was 0.0181, but cost-adjusted long-short annualized return was -8.25%.
Rotation reduced maximum drawdown from -40.72% to -13.27%, yet annual return was only 0.37%
and Sharpe 0.088, both below baseline. Its 155 trades incurred CNY 8,032 in fees and
CNY 76,610 in slippage loss.

Attribution: fixed income averaged 68.38% weight and contributed +9.72% return and 6.89% risk;
China equity averaged 24.50% and contributed -6.62% return and 93.11% risk. P&L reconciled.

Action: archive the learning Factor and do not deploy the strategy. A lower-turnover, volatility-
targeted, or different-signal proposal needs a new prior question and unseen sample.
```

## Completion check

- [ ] The Factor domain contains only `equity` and `fixed_income`, with no gold or commodity ETF in the research universe.
- [ ] You can distinguish the frozen Panel universe from the three traded assets.
- [ ] Baseline and rotation use the same dates, capital, and costs.
- [ ] You did not convert slightly positive Rank IC into an economic pass.
- [ ] Return contributions reconcile to portfolio return and risk contributions sum to 100%.
- [ ] You can explain why 24.50% China-equity average weight produced 93.11% risk contribution.
- [ ] You did not mislabel gold/commodity risk drivers as gold/commodity holdings.
- [ ] Stress scenarios remain linear estimates rather than forecasts.
- [ ] The verdict includes defensive behavior, return shortfall, and cost burden.
- [ ] The learning Factor is archived and the strategy is not deployed.

## Related articles

- [Research a cross-asset Panel Factor](/help/factors/panel-research)
- [Publish a Factor](/help/factors/publish-factor)
- [Use a Factor in a strategy](/help/factors/factor-in-strategy)
- [Read multi-asset allocation attribution](/help/backtesting/allocation-attribution)
- [Read portfolio risk research](/help/backtesting/portfolio-risk)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
