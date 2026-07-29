# Turnover, trading costs, and net returns

Decile returns and Rank IC describe a historical ranking relationship. If group membership changes frequently, commission, stamp duty, and slippage accumulate, so turnover and net results also matter.

## Highest-group turnover

The page defines highest-group turnover as the share of current D10 names that were not in the previous D10:

$$
TO_{D10,t}
=
\frac{\left|D10_t\setminus D10_{t-1}\right|}
{\left|D10_t\right|}
$$

- \(D10_t\) is the current highest-factor group.
- \(D10_{t-1}\) is the previous group.
- The set difference contains names present now but not previously.

If D10 contains 100 stocks and 16 are new this month:

$$
TO_{D10,t}=\frac{16}{100}=16\%
$$

The report displays average one-way turnover across periods. A 16% value does not necessarily mean that exactly 16% of account value trades because actual amounts depend on weights and prices.

## Basis points

Cost settings use basis points:

$$
1\text{ bp}=0.01\%=0.0001
$$

For example:

- 2.5 bp commission = 0.025%.
- 5 bp sell-side stamp duty = 0.05%.
- 10 bp slippage = 0.10%.

The numbered areas are:

1. One-side trading costs.
2. Commission.
3. Sell-side stamp duty.
4. Slippage.

![Commission, stamp duty, and slippage settings](/help/zh/factors/factor-cost-settings-01.png)

Commission and slippage apply on both buy and sell sides. Stamp duty applies only on the sell side.

## Round-trip cost

Let:

- \(c\) be commission per side.
- \(s\) be slippage per side.
- \(\tau\) be sell-side stamp duty.

Then:

$$
C_{buy}=c+s
$$

$$
C_{sell}=c+\tau+s
$$

The cost of buying and later selling is:

$$
C_{round}=2c+\tau+2s
$$

Using the displayed defaults:

$$
C_{round}
=2\times2.5+5+2\times10
=30\text{ bp}
=0.30\%
$$

## Cost in the long-short construction

The page constructs a hypothetical long D10 and short D1 portfolio. Both legs incur costs when membership changes:

$$
C_t
=
\left(TO_{D10,t}+TO_{D1,t}\right)C_{round}
$$

$$
R^{net}_{LS,t}
=
R^{gross}_{LS,t}-C_t
$$

If D10 turnover is 16%, D1 turnover is 20%, and round-trip cost is 0.30%:

$$
C_t=(16\%+20\%)\times0.30\%=0.108\%
$$

If gross long-short return is 1.20%:

$$
R^{net}_{LS,t}=1.20\%-0.108\%=1.092\%
$$

The first formation has no previous membership. The page charges the buy and sell costs required to establish both legs.

## Read gross and net results

The numbered areas are:

1. Gross-versus-net long-short NAV.
2. Gross and net curves.
3. Portfolio and cost definition.
4. Net annualized return, Sharpe, and maximum drawdown.

![Gross and net long-short NAV and net metrics](/help/zh/factors/factor-cost-results-01.png)

1. Compare the distance between gross and net curves.
2. Check whether the distance keeps widening.
3. Check whether net annualized return remains positive.
4. Inspect net maximum drawdown.
5. Return to the top-group turnover metric.
6. Run a realistic alternative cost assumption instead of keeping only the lowest-cost result.

## Real-world differences

The long-short portfolio is a research construction:

- A regular account may not be able to short D1.
- The default costs do not include the available short list or stock-borrow fees.
- Limit moves, suspensions, capacity, and market impact can change execution.
- Small and illiquid stocks are harder to trade at calculated prices.

Use the result to compare whether a factor survives basic friction. It is not an achievable-return promise.

## Related articles

- [Decile and forward returns](/help/factors/decile-returns)
- [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
