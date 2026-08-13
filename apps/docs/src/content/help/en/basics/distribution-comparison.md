# How to read a two-group distribution comparison

A two-group distribution comparison asks whether one measure systematically differs between group A and group B. An example is whether CSI 300 and CSI 500 constituents have different price-to-book ratios on the same snapshot. It describes a difference in the observed sample; it does not establish causality or predict future returns.

## Check comparability first

Before reading a test statistic, verify:

1. **Same snapshot:** both groups must resolve to the same data date.
2. **Same measure semantics:** definition, unit, and version must match.
3. **Comparable eligibility:** listing age, suspension, risk-warning, and missing-value rules must be applied consistently.
4. **No population truncation:** a full-distribution comparison must not first keep only a top-N subset.
5. **Prespecified direction:** decide whether A should be higher, lower, or simply different before inspecting the result.

## Mean difference and the Welch interval

The main estimand is the sample mean difference:

$$
\widehat{\Delta}=\bar{x}_A-\bar{x}_B
$$

Welch inference does not force the two groups to have equal variances. The standard error is:

$$
SE(\widehat{\Delta})=\sqrt{\frac{s_A^2}{n_A}+\frac{s_B^2}{n_B}}
$$

A 95% interval expresses estimation uncertainty under the sampling and model assumptions. If it includes zero, the sample does not provide clear evidence of a mean difference. Excluding zero does not imply that the difference is large or economically useful.

## Why ranks and effect sizes are also reported

- **Mann–Whitney** compares relative ranks without assuming a normal distribution. It is not merely a median test when distribution shapes differ.
- **Cohen's d** expresses the mean difference in pooled-standard-deviation units, helping distinguish negligible, small, moderate, and large differences.
- **Cliff's delta** is the probability advantage that a random A value exceeds a random B value minus the reverse probability; it ranges from −1 to 1.

With a large sample, a tiny difference can produce a small p-value. The workbench therefore does not base its conclusion on significance alone; it also checks magnitude and direction.

## Extreme-value sensitivity

Valuation ratios often have long tails. The workbench caps each group's lower and upper tails at selected quantiles, then recomputes the winsorized mean difference. If the raw and winsorized differences change sign, the conclusion is sensitive to extreme values and should not be stated strongly.

## Python teaching example

```python
import numpy as np
from scipy import stats

mean_difference = group_a.mean() - group_b.mean()
welch = stats.ttest_ind(group_a, group_b, equal_var=False)
mann_whitney = stats.mannwhitneyu(group_a, group_b, alternative="two-sided")

def winsorized_mean(values, tail=0.05):
    lower, upper = np.quantile(values, [tail, 1 - tail])
    return np.clip(values, lower, upper).mean()

sensitivity = winsorized_mean(group_a) - winsorized_mean(group_b)
```

## Limits on conclusions

- A cross-sectional difference does not show that index membership caused it. Size, industry, profitability, growth, and selection can confound the result.
- One latest snapshot can reflect the current market regime; temporal stability requires a separate multi-snapshot study.
- Trying many measures, groups, or dates and reporting only the best result creates multiple-testing bias.
- The comparison contains no future return, turnover, cost, or capacity evidence and cannot directly be restated as a factor conclusion.

## Further reading

- [SciPy independent-sample t-test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html)
- [SciPy Mann–Whitney U test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html)
- [How to read a time-series relationship study](/docs/help/basics/time-series-relationships)
