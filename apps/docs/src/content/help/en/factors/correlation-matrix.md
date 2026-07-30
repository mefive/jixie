# Factor correlation matrix

The factor correlation matrix checks whether several factors gave stocks similar rankings during the same periods. It helps answer:

- Are two factors repeating similar information?
- Does a factor mainly follow company size?
- Do factors intended for joint use have heavily overlapping historical rankings?

Low correlation does not make a factor effective, and high correlation does not automatically require deleting one. The matrix only describes historical ranking relationships.

## How the page calculates it

For every monthly or weekly observation, the page calculates Spearman rank correlation among stocks that have both factor values:

$$
\rho_{A,B,t}
=
\operatorname{Corr}\left(
\operatorname{Rank}(F_{A,t}),
\operatorname{Rank}(F_{B,t})
\right)
$$

- \(F_{A,t}\) and \(F_{B,t}\) are cross-sectional factor values during period \(t\).
- \(\operatorname{Rank}\) converts factor values to stock ranks.
- \(\rho_{A,B,t}\) lies between −1 and 1.

The page then averages valid periods:

$$
\bar{\rho}_{A,B}
=
\frac{1}{T}\sum_{t=1}^{T}\rho_{A,B,t}
$$

The result is the average ranking relationship over the selected history, not a correlation from one day.

## Select factors and calculate

1. Open **Factor library**.
2. Select **Correlation matrix**.
3. Choose 2–8 factors.
4. Verify the frequency and years in the note.
5. Select **Calculate**.

The matrix uses the monthly or weekly frequency and date range from the factor page's right-hand settings bar. Close the dialog and change those settings first if you need another range.

The numbered areas below are:

1. Selected factors.
2. Calculation method, date range, and fixed size-column note.
3. **Calculate**.

![Selecting factors and verifying the correlation date range](/docs/images/help/zh/factors/factor-correlation-settings-01.png)

The page automatically adds a **Size (ln)** column to check whether factor rankings resemble log total-market-cap rankings. It is not a fourth research factor selected by the user.

## Read the heatmap

The numbered areas below are:

1. Selected factors.
2. Pairwise factor-correlation heatmap.
3. Valid periods, color direction, and diagonal explanation.

![Correlation matrix for earnings yield book-to-market dividend yield and size](/docs/images/help/zh/factors/factor-correlation-result-01.png)

Each cell combines one row and one column:

- **Near 1**: the factors often rank stocks similarly.
- **Near −1**: the factors often rank stocks in opposite order.
- **Near 0**: there is no stable same-direction or opposite-direction ranking relationship.
- **Diagonal equals 1**: every factor is identical to itself.

Red means positive correlation and blue means negative correlation. Deeper color usually means a larger absolute value.

A value of 0.51 means the historical rankings had a noticeable positive relationship. It does not mean that 51% of stocks were the same. Correlation is not a stock-overlap percentage.

## Judge repeated information

Do not apply one fixed cutoff and mechanically remove factors. Use this sequence:

1. Read the sign and absolute correlation.
2. Check whether it remains similar in other ranges and frequencies.
3. Review both factors' economic meaning and data source.
4. Compare size- and industry-neutralized reports.
5. Check costs, turnover, and formal holdout evidence.

If two factors stay strongly positively correlated and also have similar meaning and inputs, they may repeat similar information. Combining them does not automatically create diversification.

Strong negative correlation can also represent the same information in reverse. Taking a reciprocal or changing a sign can reverse a factor's ranking.

## Use the size column

A noticeable correlation with **Size (ln)** means the factor often ranks large- or small-cap stocks in a similar way.

- Positive: higher factor values often occur among larger companies.
- Negative: higher factor values often occur among smaller companies.

This does not automatically make the factor wrong. It is a prompt to run size or size-and-industry neutralization and see how much of the result is explained by size exposure.

## Common mistakes

- Treating low correlation as proof that a multi-factor combination will be better.
- Treating correlation as causation.
- Reading only the full-period average and ignoring changes across subperiods.
- Ignoring direction and treating −0.9 as unrelated.
- Deleting a factor solely because it relates to size, without a neutralization comparison.
- Using the matrix as a return forecast.

The matrix screens for repeated information. Keeping a factor still requires a hypothesis, sound data treatment, single-factor results, trading costs, and out-of-sample evidence.

## Related articles

- [Size and industry neutralization](/help/factors/neutralization)
- [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir)
- [Pre-run research cards and variants](/help/factors/research-card)
- [Formal holdout and out-of-sample results](/help/factors/holdout-results)
