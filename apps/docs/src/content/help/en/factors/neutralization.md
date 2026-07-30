# Size and industry neutralization

Neutralization tests whether a factor result merely repeats size or industry differences. It removes the part of the factor value explained by those variables, then ranks the remaining component and recalculates deciles and Rank IC.

## Why neutralize

Suppose a factor often ranks small companies highly during a period when small companies generally perform well. The raw result may contain:

- The factor's own ranking relationship.
- The common performance of small companies.
- Both effects.

Industry can have the same effect. A valuation factor may place banks in the same group, so the result also contains the industry's common movement.

Neutralization does not remove risk and is not a switch for improving returns. It changes the question being tested.

## Size-neutral formula

The analysis performs a cross-sectional regression on each rebalance date:

$$
F_{i,t}
=
\alpha_t
+\beta_t\ln(MV_{i,t})
+\varepsilon_{i,t}
$$

- \(F_{i,t}\) is the raw factor value.
- \(MV_{i,t}\) is total market capitalization.
- \(\alpha_t+\beta_t\ln(MV_{i,t})\) is the part explained by size.
- \(\varepsilon_{i,t}\) is the remaining component.

The neutralized factor value is the residual \(\varepsilon_{i,t}\).

If a stock's raw factor value is 0.08 and its size-implied value is 0.06:

$$
\varepsilon=0.08-0.06=0.02
$$

If another stock has a raw value of 0.04 and an implied value of 0.05:

$$
\varepsilon=0.04-0.05=-0.01
$$

The neutralized analysis compares 0.02 with −0.01, not the original 0.08 with 0.04.

## Size-and-industry formula

**Size + industry** adds industry variables:

$$
F_{i,t}
=
\alpha_t
+\beta_t\ln(MV_{i,t})
+\sum_{k=1}^{K}\gamma_{k,t}I_{i,k,t}
+\varepsilon_{i,t}
$$

- \(I_{i,k,t}\) indicates whether the stock belongs to industry \(k\) at the time.
- \(\gamma_{k,t}\) captures the common difference associated with that industry.
- The page uses the first-level industry classification applicable at that date.
- The residual \(\varepsilon_{i,t}\) becomes the value used for ranking.

This is not simply subtracting the industry average. Size and industry are considered together.

## Set neutralization

1. Open **More settings**.
2. Choose **None**, **Size**, or **Size + industry** under Neutralization.
3. Keep all other settings unchanged for the first comparison.
4. Select **Run again**.
5. Complete the research card and wait for the report.

The numbered areas are:

1. Size + industry selected.
2. Run again with the new definition.

![Select size and industry neutralization and run again](/docs/images/help/zh/factors/factor-neutralization-setting-01.png)

The old report continues to display its old result after changing the draft. Run again and verify **Size** or **Size + industry** in the summary before treating the new report as neutralized.

## Read the neutralized result

The numbered areas are:

1. Size + industry in the summary.
2. Sample and direction for the new report.
3. D1 through D10 formed from neutralized residuals.

![Earnings-yield report after size and industry neutralization](/docs/images/help/zh/factors/factor-neutralization-result-01.png)

Neutralization changes factor values and stock rankings. Rank IC, decile returns, turnover, and long-short returns can all change.

## Compare reports correctly

Open **Report history** and compare the **None** and **Size + industry** reports. The numbered items are:

1. Size + industry report.
2. Non-neutralized report.

![Non-neutralized and size-industry-neutralized reports in history](/docs/images/help/zh/factors/factor-neutralization-history-01.png)

Keep the following identical:

- Factor and code digest.
- Frequency and date range.
- Universe and missing-data treatment.
- Outlier treatment.
- Trading costs.
- Equal- or market-cap-weight display.

Then compare:

1. Whether the sign of Rank IC changes.
2. Whether the D1-to-D10 order remains.
3. Whether ICIR and positive rate fall materially.
4. Whether turnover and net results change.

If a strong raw result weakens materially after neutralization, size or industry explained part of the original result. If it remains, that still does not guarantee future effectiveness; it only indicates that these two exposures do not fully explain the historical relationship.

Do not retain only the best of **None**, **Size**, and **Size + industry**. They answer different questions.

## Related articles

- [Decile and forward returns](/help/factors/decile-returns)
- [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir)
- [Set the analysis range and sample treatment](/help/factors/analysis-settings)
