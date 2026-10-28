# Read multi-asset allocation attribution

> Figures labeled “Historical Chinese UI example” preserve the original result or state; their values have not been recalculated. Follow the article steps and current captures for today’s controls.

Every new backtest produces cash-account attribution, with no Factor requirement. It covers stock / ETF holdings and uninvested cash. All initial capital belongs to this account. Historical reports preserve their original scope.

## Open attribution

1. Run a stock, ETF, or mixed strategy.
2. Wait for completion.
3. Find Multi-asset allocation attribution.
4. Confirm Reconciled to cash-account equity before switching tabs.

![Historical Chinese UI example: Asset-class and asset-level allocation attribution](/docs/images/help/zh/backtesting/allocation-attribution-01.png)

## Asset class and asset

Both tables show average weight, return contribution, risk contribution, costs, and net P&L. Classifications currently come from approved research universes supplied by the factor host. Actual holdings without a classification appear as Other. Without classifications, class correlation diagnostics are unavailable; missing data is not zero.

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

## Historical interface

Rate-regime attribution is retired. The figure preserves the old interface; rolling correlation remains available.

![Historical Chinese UI example: correlation and retired rate-regime attribution](/docs/images/help/zh/backtesting/allocation-attribution-02.png)

## Related articles

- [Run cross-asset Panel research](/docs/help/factors/panel-research)
- [Read backtest results](/docs/help/backtesting/results-overview)
