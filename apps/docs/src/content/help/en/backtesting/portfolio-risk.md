# Read portfolio risk diagnostics

Risk research explains which market drivers the completed multi-asset backtest was sensitive to, how macro conditions moved with returns, and whether Alpha may overlap known risk. It does not alter trades and is not a return forecast.

## Market risk

Market risk uses up to 252 complete daily observations in a multivariate regression and an EWMA factor covariance matrix. Drivers include China equity, government-curve level/slope/curvature, credit spread, USD/CNH, US real yield, gold, and commodities.

$$
r_{p,t}=\alpha+\sum_{k=1}^{9}\beta_k f_{k,t}+\varepsilon_t
$$

\(\beta_k\) is contemporaneous sensitivity to driver \(k\). Return factors display beta; rate and spread factors display estimated impact per 10bp. These are statistical exposures, not bond duration or proof of causality.

![Portfolio market exposures and variance contributions](/docs/images/help/zh/backtesting/portfolio-risk-01.png)

## Macro sensitivity

Growth, inflation, liquidity, credit, and external-pressure changes enter one monthly regression. The page shows coefficients and Newey–West t-statistics.

Latest-value exploration means historical macro values include revisions collected later. It can describe a possible relationship but cannot be treated as future-data-free evidence. If qualified data is missing, the section is omitted; absence is not zero sensitivity.

## Alpha / Risk overlap

The report correlates net Alpha returns or actual strategy attribution with each market driver at the same horizon. Low means no obvious linear overlap; material and dominant require closer inspection. Low correlation does not prove causal Alpha, and negative correlation can represent a meaningful hedge.

## Stress scenarios

Deterministic and historical scenarios apply current estimated exposures linearly:

$$
\widehat{\Delta R}=\sum_k\beta_k\Delta f_k
$$

Scenarios include an A-share drawdown, government-yield moves, wider credit spreads, RMB depreciation, higher US real yields, a commodity drawdown, and cross-asset risk-off.

![Macro warning, Alpha overlap, and stress scenarios](/docs/images/help/zh/backtesting/portfolio-risk-02.png)

The estimate excludes changing exposures, liquidity shocks, nonlinear pricing, and actual execution paths. Historical replay means applying similar historical driver changes to today's exposures, not replaying the old portfolio return.

## Reading order

Check the as-of date, observations, and data policy; identify leading variance contributors; read macro coefficients with the revision warning; inspect Alpha overlap; then compare several stress scenarios rather than selecting the mildest one.

## Related articles

- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
- [Return and risk metrics](/docs/help/basics/performance-risk)
- [Why a backtest is not a forecast](/docs/help/basics/backtest-limitations)
