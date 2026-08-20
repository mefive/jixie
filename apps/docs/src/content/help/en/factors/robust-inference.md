# Read robust cross-sectional inference

In addition to Rank IC, bucket returns, and net long-short returns, a stock cross-sectional Factor report provides Newey–West mean inference and a fixed-control Fama–MacBeth regression. They estimate uncertainty in the historical average relationship and incremental association after common styles; they do not guarantee returns.

## Newey–West mean inference

Period-by-period Rank IC and long-short returns can be serially related, so months should not be treated as fully independent. The report calculates:

$$
t_{NW}=\frac{\bar{x}}{SE_{NW}(\bar{x})}
$$

and the 95% confidence interval:

$$
\bar{x}\pm1.96\,SE_{NW}(\bar{x})
$$

Here, $x_t$ is the Rank IC or long-short return for each formation period. The page reports the mean, Newey–West standard error, t statistic, confidence interval, number of periods, and automatically selected lag.

Read it in this order:

1. Check whether the mean direction matches the prespecified hypothesis.
2. See whether the confidence interval crosses zero. If it does, no average relationship remains compatible with the data.
3. Check the number of periods and lag, not only the t statistic.
4. Review gross and net long-short inference under both equal- and value-weighting. The toggle displays existing results and does not rerun the study.

![Newey–West inference for Rank IC and long-short returns](/docs/images/help/zh/factors/robust-inference-01.png)

## Fixed-control Fama–MacBeth regression

For each valid formation date, the report estimates:

$$
r_{i,t+1}=\alpha_t+\beta_t f_{i,t}+\gamma_t' z_{i,t}+\varepsilon_{i,t+1}
$$

$f_{i,t}$ is the candidate Factor and $z_{i,t}$ is the fixed size, value, momentum, and quality control set. The second step applies Newey–West inference to the mean candidate coefficient $\beta_t$.

Focus on:

- the mean candidate coefficient and direction;
- Newey–West t statistic and 95% interval;
- successful regression periods and average complete observations;
- control set, standardization, and missing reasons;
- collinearity notices such as `collinear_exposure`.

Missing controls affect only the complete-case auxiliary regression. They do not rewrite the main IC, buckets, or long-short result. Controls are not removed merely to make the candidate significant.

![Fixed-control Fama–MacBeth inference](/docs/images/help/zh/factors/robust-inference-02.png)

## Combine the evidence

- Agreement among main direction, bucket monotonicity, net returns, and robust inference is more complete evidence.
- Strong raw Rank IC but a near-zero controlled coefficient can indicate repeated size, value, momentum, or quality exposure.
- A large t statistic with few periods, unstable coverage, or no result after costs is not sufficient on its own.
- These statistics do not replace Holdout and do not establish causality.

## Common questions

### Why does Newey–West differ from an ordinary t statistic?

Newey–West allows heteroskedasticity and bounded serial correlation. When the ordinary method understates uncertainty, the robust t statistic is usually smaller.

### The report has no robust inference

Frozen historical reports are not backfilled. Run a new report under the current protocol. When periods or complete observations are insufficient, the Fama–MacBeth section states why it is unavailable.

## Related articles

- [Read your first factor analysis result](/docs/help/factors/results-overview)
- [Rank IC and ICIR](/docs/help/factors/rank-ic-icir)
- [Formal holdout results](/docs/help/factors/holdout-results)

