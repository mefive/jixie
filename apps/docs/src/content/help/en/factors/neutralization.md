# Size neutralization

Neutralization tests whether a factor result mainly repeats size differences. The current choices are **None** and **Size**. Industry data, industry neutralization and within-industry ranking have been removed.

## What it calculates

A separate regression with an intercept is fitted on each rebalance date:

$$
F_{i,t}=\alpha_t+\beta_t\ln(MV_{i,t})+\varepsilon_{i,t}
$$

- \(F_{i,t}\) is the raw factor value.
- \(MV_{i,t}\) is that date's positive total market capitalization.
- \(\alpha_t+\beta_t\ln(MV_{i,t})\) is the part explained by size.
- \(\varepsilon_{i,t}\) is the residual used for ranking, deciles and Rank IC.

For a raw value of \(0.08\) and a size-implied component of \(0.06\):

$$
0.08-0.06=0.02
$$

Size neutralization neither guarantees returns nor controls every shared risk. It changes the question being tested.

## Run an analysis

1. Select a stock cross-sectional factor and open **More settings**.
2. Choose **Size**, or **None** to study raw factor values.
3. Declare the all-A-share or historical index-constituent universe; keep dates, samples, outliers and costs fixed when comparing results.
4. Run the analysis and inspect its neutralization parameters, Rank IC, decile returns and missing samples.

The current protocol estimates residuals after formal universe and eligibility filtering. Stocks without positive market capitalization cannot enter size neutralization. Results may strengthen or weaken; do not retain only the better result.

## Historical UI archive

These figures preserve earlier controls and original results that included industry settings. Values have not been recalculated. Industry controls are retired, so the figures are not current operating instructions. Old industry parameters fail explicitly instead of becoming size neutralization. Saved report data is not rewritten.

![Historical Chinese UI example: Select size and industry neutralization and run again](/docs/images/help/zh/factors/factor-neutralization-setting-01.png)

![Historical Chinese UI example: Earnings-yield report after size and industry neutralization](/docs/images/help/zh/factors/factor-neutralization-result-01.png)

![Historical Chinese UI example: Non-neutralized and size-industry-neutralized reports in history](/docs/images/help/zh/factors/factor-neutralization-history-01.png)

## Related reading

- [Analysis settings](/docs/help/factors/analysis-settings)
- [Rank IC, ICIR and IC decay](/docs/help/factors/rank-ic-icir)
- [Decile returns](/docs/help/factors/decile-returns)
