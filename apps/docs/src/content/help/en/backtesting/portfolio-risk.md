# Read portfolio risk diagnostics

Risk research retains independent monthly macro sensitivity using stock / ETF cash-account NAV. It describes contemporaneous relationships between macro changes and portfolio returns, without altering trades or forecasting the next return.

Daily market risk, Alpha / Risk overlap and stress scenarios depended on retired futures data. Historical report content is retained; new reports no longer generate these sections.

## Macro sensitivity

Growth, inflation, liquidity, credit and external-pressure changes enter one monthly regression. The page shows coefficients, Newey–West t-statistics, effective observations, lag and the as-of date.

A coefficient describes historical return sensitivity per one-point change in a macro axis. It does not establish causality. Robust standard errors account for serial dependence; a larger t-statistic does not guarantee future validity.

## Check the data policy

1. Open Allocation attribution in a completed backtest, then Risk research.
2. Check the as-of date and effective monthly observations.
3. Check whether the data policy is Strict PIT or Latest-value exploration.
4. Read coefficients together with t-statistics, sample size and limitations.

Latest-value exploration includes revisions collected later and cannot represent information known at the historical decision time. Missing qualified data produces no macro result; absence is not zero sensitivity.

## Historical interface record

These figures preserve old results without recalculation. Their market-risk, Alpha-overlap and stress-scenario controls have been removed and cannot be followed as current instructions.

![Historical Chinese UI example: Retired daily market-risk interface](/docs/images/help/zh/backtesting/portfolio-risk-01.png)

![Historical Chinese UI example: Old macro warning and retired stress scenarios](/docs/images/help/zh/backtesting/portfolio-risk-02.png)

## Related articles

- [Read multi-asset allocation attribution](/docs/help/backtesting/allocation-attribution)
- [Return and risk metrics](/docs/help/basics/performance-risk)
- [Why a backtest is not a forecast](/docs/help/basics/backtest-limitations)
