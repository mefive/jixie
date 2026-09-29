# Read multi-asset allocation attribution

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Every new backtest produces cash-account attribution, with no Factor requirement. It covers stock / ETF holdings and uninvested cash, excluding futures P&L; mixed strategies still analyze their cash account. A futures-only run with zero initial cash-account capital produces an empty, zero-P&L report without invalid return or risk ratios. Historical reports preserve their original scope.

## Open attribution

1. Run a stock, ETF, or mixed strategy.
2. Wait for completion.
3. Find Multi-asset allocation attribution.
4. Confirm Reconciled to cash-account equity before switching tabs.

![Historical Chinese UI example: Asset-class and asset-level allocation attribution](/docs/images/help/zh/backtesting/allocation-attribution-01.png)

## Asset class and asset

Both tables show average weight, return contribution, risk contribution, costs, and net P&L. Classifications currently come from approved research universes supplied by the factor host. Actual holdings without a classification appear as Other. Without classifications, class correlation and rate-regime diagnostics are unavailable; missing data is not zero.

Return contribution is additive relative to initial cash-account capital:

$$
C_i=\frac{\text{net P&L of asset }i}{\text{initial cash-account capital}}
$$

Asset P&L and costs should reconcile to the change in cash-account equity. Risk contribution uses covariance between each asset's daily net contribution return and cash-account daily return, normalized to 100% when cash-account return variance is valid. A negative contribution indicates historical diversification, not zero risk.

## Allocation drift

Allocation drift records decision date, next-day execution date, pre-trade drift, post-trade drift, and maximum single-asset deviation. Residual post-trade drift can result from board lots, cash, opening gaps, or fill constraints.

## Correlation

Correlation offers 60-day and 120-day windows, an asset-class heatmap, and month-end rolling series for any class pair.

$$
\rho_{A,B}=\frac{\operatorname{Cov}(r_A,r_B)}{\sigma_A\sigma_B}
$$

Insufficient paired returns or zero variance produces a missing value, not zero. A high-correlation warning means historical diversification may have weakened; low correlation does not guarantee stability under stress.

## Rate regime

Rate regime uses official government curves available by the decision date. The 10-year yield versus 60 curve observations ago determines rising or falling rates. The 10Y−2Y spread versus its 252-observation median determines steep or flat.

![Historical Chinese UI example: Rolling correlation and rate-regime attribution](/docs/images/help/zh/backtesting/allocation-attribution-02.png)

Conditional returns, volatility, positive days, and worst episode drawdown are retrospective. The state does not affect this run's weights and is not published as a Factor.

## Related articles

- [Run cross-asset Panel research](/docs/help/factors/panel-research)
- [Read backtest results](/docs/help/backtesting/results-overview)
- [Read portfolio risk diagnostics](/docs/help/backtesting/portfolio-risk)
