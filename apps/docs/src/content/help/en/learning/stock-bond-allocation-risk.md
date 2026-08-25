# Stock-bond allocation and risk attribution: contributions, correlation, and stress scenarios

> Learning path · About 120–150 minutes · Complete one Panel Factor analysis and one multi-asset backtest first.

This exercise asks a question that an equity curve can hide: **where did the return and risk of a stock-bond rotation actually come
from, and did it become a better strategy after reducing drawdown?** You will create a stock-and-bond Panel Factor with no gold or
commodity ETFs, use it for a monthly rotation among the CSI 300, 5-year CGB, and 10-year CGB ETFs, and use equity, static
stock-bond, and zero-cost rotation controls to separate asset allocation, timing, and execution costs. You will then audit return
contribution, risk contribution, correlation, rate regimes, market risk, and stress scenarios.

This is not an allocation recommendation. The real run deliberately retains a result with much smaller drawdown but inferior return,
so the exercise cannot be passed by selecting the most flattering risk statistic.

## The fixed case was run end to end

On 2026-08-25, a fresh account ran the Panel report, publication, four backtests, and the complete risk attribution through the real
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
| Static diagnostic control | 24.50% CSI 300, 34.19% 5-year CGB, 34.19% 10-year CGB, and 7.12% cash; monthly rebalancing |
| Zero-cost diagnostic control | Identical momentum rule with commission, minimum commission, taxes, slippage, and impact set to zero |
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

### Actual results from four diagnostic controls

| Run | Total return | Annual return | Max drawdown | Sharpe | Annual turnover | Trades | Fees | Slippage loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 95% CSI 300 ETF buy-and-hold | 28.84% | 3.12% | -40.72% | 0.258 | 0.05× | 1 | CNY 237.50 | CNY 360.96 |
| Static stock-bond diagnostic | **36.35%** | **3.83%** | **-6.00%** | **0.828** | 0.13× | 201 | CNY 1,247.22 | CNY 2,701.70 |
| Zero-cost stock-bond momentum | 12.41% | 1.43% | -12.00% | 0.242 | 1.89× | 147 | CNY 0 | CNY 0 |
| Monthly stock-bond momentum | 3.10% | 0.37% | -13.27% | 0.088 | 1.89× | 155 | CNY 8,032.40 | CNY 76,609.55 |

![Actual CSI 300 ETF buy-and-hold baseline](/docs/images/help/zh/learning/stock-bond-baseline-result.png)

![Actual static stock-bond diagnostic control](/docs/images/help/zh/learning/stock-bond-static-allocation-result.png)

![Actual zero-cost stock-bond momentum control](/docs/images/help/zh/learning/stock-bond-zero-cost-allocation-result.png)

![Actual costed stock-bond momentum result](/docs/images/help/zh/learning/stock-bond-allocation-result.png)

The four controls separate three diagnostic explanations:

1. **Asset-allocation effect:** static stock-bond allocation cut maximum drawdown to -6.00% while its 36.35% total return exceeded
   the equity baseline's 28.84%. This sample's defensive behavior did not require momentum timing.
2. **Timing effect:** even with every cost set to zero, momentum earned only 12.41% with a 0.242 Sharpe, trailing static allocation by
   23.94 percentage points and 0.586 Sharpe. The timing rule was the main negative contributor, not the source of lower drawdown.
3. **Cost effect:** realistic costs reduced momentum from 12.41% to 3.10%, an observed 9.31-percentage-point difference, and worsened
   drawdown and Sharpe again.

The static weights reference the dynamic strategy's observed average exposures. They are therefore an **in-sample diagnostic
control**, not a new investable benchmark. The zero-cost run is likewise unattainable and supplies only a hypothetical upper bound
under this execution model. Neither control may be relabeled as out-of-sample evidence.

The fixed verdict is: **stock-bond mixing showed historical defensive value, but momentum timing materially degraded the result and
costs widened the deficit again; this is not a production candidate.**

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
3. use equity, static stock-bond, zero-cost dynamic, and realistic-cost dynamic runs to separate allocation, timing, and costs;
4. distinguish an in-sample diagnostic control from an out-of-sample benchmark;
5. reconcile return, cost, and risk contribution at both asset and asset-class levels;
6. interpret rolling correlation, rate regimes, market/macro risk, and stress scenarios correctly; and
7. reject a candidate when drawdown improves but return, Sharpe, and costs do not qualify.

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

## Step 4: build equity and static stock-bond controls

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

Then run the monthly rebalanced static stock-bond diagnostic:

```ts
const equity = '510300.SH';
const bond5y = '511010.SH';
const bond10y = '511260.SH';
let lastMonth = '';

export default defineStrategy({
  name: 'Learning case: static stock-bond diagnostic',
  watch: [equity, bond5y, bond10y],
  onBar(ctx) {
    const month = ctx.period('monthly');
    if (month === lastMonth) return;
    lastMonth = month;
    ctx.orderTargetPercent(equity, 0.245);
    ctx.orderTargetPercent(bond5y, 0.3419);
    ctx.orderTargetPercent(bond10y, 0.3419);
  },
});
```

The targets sum to 92.88%, leaving 7.12% in cash. They reference the dynamic strategy's in-sample average exposures and answer only,
“What happened to a similar stock-bond mix without timing?” They are not an independent out-of-sample benchmark.

Use 2018-01-01 through 2026-07-30, CNY 1 million, and identical realistic costs for the equity baseline, static stock-bond control,
and costed rotation. Otherwise returns and drawdowns are not directly comparable.

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

## Step 6: isolate execution drag with a zero-cost run

Keep momentum code, data, dates, and capital unchanged. Set only the backtest request's complete cost object to zero:

```json
{
  "commission": 0,
  "minCommission": 0,
  "stampDuty": 0,
  "transferFee": 0,
  "slippageBps": 0,
  "impactCoef": 0
}
```

This is an automated-acceptance diagnostic, not a deployable trading assumption. The actual zero-cost run made 147 trades and
reported exactly zero fees and slippage. Its 12.41% total return still trailed the static stock-bond control's 36.35%, so costs cannot
explain the entire costed shortfall. Trade counts need not match the costed run: costs change affordable share quantities and the
subsequent cash path.

## Step 7: read allocation analysis in order

1. **Asset classes:** reconcile portfolio and attributed P&L before comparing weight, return, and risk contribution.
2. **Assets:** verify that only the three strategy assets have nonzero positions; the rest of the research universe stays at zero.
3. **Correlation:** compare 60- and 120-day windows and rolling paths, not only the latest value.
4. **Rate regime:** describe state results as historical conditions, not predictions.
5. **Risk research:** keep daily market risk separate from monthly macro sensitivity and verify lineage.
6. **Stress scenarios:** state that results are linear current-exposure estimates without rebalancing, liquidity shocks, or nonlinear paths.

Risk contribution allocates component/portfolio covariance. It may be much larger than average weight and can be negative. Return and
risk contribution answer different questions and are not interchangeable.

## Step 8: write the verdict

```text
Research verdict: do not advance to a production candidate.

Evidence: Panel Rank IC was 0.0181, but cost-adjusted long-short annualized return was -8.25%.
Static stock-bond allocation returned 36.35% with -6.00% maximum drawdown and 0.828 Sharpe.
The identical momentum rule returned only 12.41% with 0.242 Sharpe even at zero cost, making
timing the primary negative contributor. Realistic costs reduced return again to 3.10% and
Sharpe to 0.088; 155 trades incurred CNY 8,032 in fees and CNY 76,610 in slippage loss.

Attribution: fixed income averaged 68.38% weight and contributed +9.72% return and 6.89% risk;
China equity averaged 24.50% and contributed -6.62% return and 93.11% risk. P&L reconciled.

Cause: drawdown improvement came mainly from mixing stocks and bonds. Current momentum timing
damaged static allocation's return and risk-adjusted result, and trading costs widened the gap.
The static and zero-cost runs are in-sample diagnostics only.

Action: archive the learning Factor and do not deploy the strategy. A lower-turnover, volatility-
targeted, or different-signal proposal needs a new prior question and unseen sample; do not tune
repeatedly against these diagnostic results.
```

## Completion check

- [ ] The Factor domain contains only `equity` and `fixed_income`, with no gold or commodity ETF in the research universe.
- [ ] You can distinguish the frozen Panel universe from the three traded assets.
- [ ] Equity, static stock-bond, zero-cost dynamic, and realistic-cost dynamic controls use identical dates, capital, and market data.
- [ ] You can separate asset allocation, timing, and cost effects from the four actual results.
- [ ] You did not relabel in-sample static weights or the unattainable zero-cost run as an out-of-sample benchmark.
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
