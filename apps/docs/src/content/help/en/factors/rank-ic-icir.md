# Rank IC, ICIR, and IC decay

Rank IC measures the relationship between the factor ranking and subsequent return ranking. It does not require a fixed proportional relationship between raw factor values and returns.

## Rank IC formula

For each rebalance period \(t\), the analysis calculates:

$$
IC_t
=
\operatorname{Corr}_{Spearman}
\left(
\operatorname{Rank}(F_{i,t}),
\operatorname{Rank}(r_{i,t\rightarrow t+1})
\right)
$$

- \(F_{i,t}\) is stock \(i\)'s factor value in period \(t\).
- \(r_{i,t\rightarrow t+1}\) is its next-period return.
- \(\operatorname{Rank}\) converts values to ranks from low to high.
- Spearman correlation ranges from −1 to 1.

A positive Rank IC means that higher factor ranks were generally followed by higher return ranks. A negative value indicates the opposite direction.

## A five-stock example

Suppose the factor ranks are:

$$
(1,2,3,4,5)
$$

The subsequent return ranks are:

$$
(1,3,2,4,5)
$$

Only ranks 2 and 3 are reversed. With no tied ranks, Spearman correlation can also be written as:

$$
\rho
=
1-\frac{6\sum_{i=1}^{n}d_i^2}{n(n^2-1)}
$$

\(d_i\) is the difference between the two ranks. Here:

$$
\sum d_i^2=0^2+(-1)^2+1^2+0^2+0^2=2
$$

Therefore:

$$
\rho=1-\frac{6\times2}{5\times(5^2-1)}=0.9
$$

The relationship is strong in this period, but one period does not establish long-term consistency.

## Mean Rank IC

The report averages the IC values across all valid periods:

$$
\overline{IC}
=
\frac{1}{T}\sum_{t=1}^{T}IC_t
$$

- \(T\) is the number of valid periods.
- The sign of \(\overline{IC}\) indicates the overall direction.
- A larger absolute value indicates a stronger historical ranking relationship.

Do not apply one fixed threshold to every factor, market, and frequency.

## ICIR

ICIR compares mean IC with the variability of IC:

$$
ICIR
=
\frac{\overline{IC}}{\sigma(IC)}
$$

The page displays annualized ICIR:

$$
ICIR_{annual}
=
\frac{\overline{IC}}{\sigma(IC)}\sqrt{M}
$$

- \(\sigma(IC)\) is the standard deviation of period IC values.
- \(M=12\) for monthly analysis.
- \(M=52\) for weekly analysis.

If monthly mean IC is 0.03 and its standard deviation is 0.12:

$$
ICIR_{annual}
=
\frac{0.03}{0.12}\sqrt{12}
\approx0.87
$$

A higher ICIR indicates greater historical consistency, not guaranteed persistence. A small mean IC with very low variability can still produce a high ICIR, so read both metrics.

## IC > 0 rate

The positive-IC rate is:

$$
\text{Positive rate}
=
\frac{\#\{t:IC_t>0\}}{T}
$$

If IC is positive in 76 of 120 months:

$$
\frac{76}{120}=63.33\%
$$

This records direction only, not the size of each period's IC.

## Read the page

The numbered areas are:

1. Mean Rank IC.
2. Annualized ICIR.
3. Share of months with IC above zero.
4. Monthly turnover of the highest factor group.

![Mean Rank IC, ICIR, positive rate, and turnover](/docs/images/help/zh/factors/factor-rank-ic-01.png)

1. Read the sign of mean Rank IC to establish direction.
2. Read its absolute value to judge historical ranking strength.
3. Use ICIR and positive rate to see whether a few months drive the result.
4. Check whether the D1-to-D10 chart points in the same direction.

## IC decay

IC decay replaces the next period with several forward trading-day horizons:

$$
IC(h)
=
\operatorname{Corr}_{Spearman}
\left(
\operatorname{Rank}(F_{i,t}),
\operatorname{Rank}(r_{i,t\rightarrow t+h})
\right)
$$

\(h\) is 1, 5, 10, 20, or 60 trading days.

The numbered areas are:

1. The IC-decay section.
2. Mean Rank IC at each forward horizon.
3. The page's holding-period interpretation based on the peak.

![Rank IC at several forward horizons](/docs/images/help/zh/factors/factor-ic-decay-01.png)

- A high short horizon followed by a decline indicates a faster relationship.
- A value that rises at longer horizons indicates a slower historical relationship.
- No clear pattern means that the holding-period conclusion is unstable.

IC decay describes time scale. Do not mechanically choose the highest point after testing many horizons.

## Related articles

- [Decile and forward returns](/help/factors/decile-returns)
- [Turnover, trading costs, and net returns](/help/factors/turnover-costs)
- [Read your first factor analysis result](/help/factors/results-overview)
