# Trustworthy cross-market research: returns, FX, and correlation

> Learning path · About 60–90 minutes · You should be able to run a Python Cell, but no prior time-series statistics is required.

This exercise asks one limited question: **How strongly were the monthly CNY returns of the CSI 300, Hang Seng, and S&P 500
correlated from 2015 through 2025, and did that relationship vary over time?** The goal is falsifiable, reproducible evidence—not
selecting the market with the highest historical return or prescribing portfolio weights.

## What you will learn

You should be able to:

1. distinguish a price index, a tradable ETF, a local-currency return, and a CNY return;
2. explain why cross-market data must align on `availableDate`, not matching calendar dates;
3. freeze the question, sample, variables, and failure conditions before seeing results;
4. read full-sample correlation, rolling correlation, and a block-bootstrap interval together;
5. keep the conclusion descriptive instead of turning correlation into causality or an allocation recommendation.

## Prerequisites

- If Research documents are new to you, first [complete your first quantitative study](/docs/help/getting-started/first-research).
- If price indices and ETFs are unfamiliar, read [Stocks, ETFs, and indices](/docs/help/basics/stocks-etfs-indices).
- For the currency convention, read [How to compare China, Hong Kong, and US market returns](/docs/help/basics/cross-market-returns).

## Step 1: Freeze the question before loading data

Put this in the first Markdown Cell:

```text
Question: From 2015-01 through 2025-12, how strongly were the monthly CNY returns of the CSI 300,
          Hang Seng, and S&P 500 correlated, and was their 36-month rolling correlation stable?

Prior expectation: correlations are positive but materially below 1 and vary across market regimes.
Primary evidence: Pearson correlation on complete months, 36-month rolling correlation, and a
                  95% interval from a 12-month block bootstrap.
Falsification: if correlations stay near 1, or intervals are too wide to distinguish low, medium, and high
               correlation, the claim of stable diversification is unsupported.
Sample: 2015-01 through 2025-12; do not change dates after viewing the result.
Limits: price indices exclude dividends; CNY conversion is not ETF return; the study excludes costs and does not establish causality.
```

The prior is not a commitment to prove that diversification works. It states what would weaken the claim before an attractive
low-correlation window is visible.

## Step 2: Freeze the data semantics

| Research object | Stable ID | Local currency | CNY convention | Object it cannot replace |
| --- | --- | --- | --- | --- |
| CSI 300 Price Index | `equity.cn.csi300.price` | CNY | Same as local | `510300.SH` ETF |
| Hang Seng Price Index | `equity.hk.hsi.price` | HKD | HKD/CNY conversion | `159920.SZ` ETF |
| S&P 500 Price Index | `equity.us.spx.price` | USD | USD/CNY conversion | `513500.SH` ETF |

All three are **price indices**. They exclude dividend reinvestment and cannot be traded at index points. Hong Kong and US closes
enter the China-close information set only on the first strictly later SSE session. The Research loader already aligns on
`availableDate`; do not rebuild the join on source-market calendar dates in Python.

## Step 3: Load monthly returns and verify the FX decomposition

Add a Python Cell for local and CNY monthly returns. `partial_period="exclude"` removes an unfinished month. The ending year is
already complete, but keeping the rule explicit makes the record auditable.

```python
import numpy as np
import pandas as pd

START = "20150101"
END = "20251231"


def series_column(frame: pd.DataFrame, column: str) -> pd.DataFrame:
    return frame.rename(columns={"value": column}).set_index("date")


returns = pd.concat(
    [
        series_column(
            data.series(
                "index",
                "equity.cn.csi300.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "csi300_cny",
        ),
        series_column(
            data.series(
                "index",
                "equity.hk.hsi.price",
                start=START,
                end=END,
                measure="market.adjusted_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_local",
        ),
        series_column(
            data.series(
                "index",
                "equity.hk.hsi.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_cny",
        ),
        series_column(
            data.series(
                "index",
                "equity.us.spx.price",
                start=START,
                end=END,
                measure="market.adjusted_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "spx_local",
        ),
        series_column(
            data.series(
                "index",
                "equity.us.spx.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "spx_cny",
        ),
    ],
    axis=1,
    join="inner",
).dropna().sort_index()

returns["hsi_fx"] = (1 + returns["hsi_cny"]) / (1 + returns["hsi_local"]) - 1
returns["spx_fx"] = (1 + returns["spx_cny"]) / (1 + returns["spx_local"]) - 1

hsi_identity_error = (
    (1 + returns["hsi_local"]) * (1 + returns["hsi_fx"]) - (1 + returns["hsi_cny"])
).abs().max()
spx_identity_error = (
    (1 + returns["spx_local"]) * (1 + returns["spx_fx"]) - (1 + returns["spx_cny"])
).abs().max()

pd.Series(
    {
        "observations": len(returns),
        "first_month": returns.index.min(),
        "last_month": returns.index.max(),
        "hsi_identity_max_error": hsi_identity_error,
        "spx_identity_max_error": spx_identity_error,
    }
)
```

Inspect the observation count, first and last months, and identity errors before computing statistics. If the common sample is
shorter than expected, inspect the platform's missing-FX diagnostics rather than inventing CNY returns with unlimited forward-fill.

## Step 4: Compare full-sample and rolling correlation

```python
cny_columns = ["csi300_cny", "hsi_cny", "spx_cny"]
full_sample_correlation = returns[cny_columns].corr()

rolling_correlation = pd.DataFrame(index=returns.index)
rolling_correlation["CSI 300 / Hang Seng"] = returns["csi300_cny"].rolling(36).corr(
    returns["hsi_cny"]
)
rolling_correlation["CSI 300 / S&P 500"] = returns["csi300_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation["Hang Seng / S&P 500"] = returns["hsi_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation = rolling_correlation.dropna().reset_index()

full_sample_correlation.round(3)
```

Plot the rolling estimates in a separate Python Cell:

```python
charts.line(
    rolling_correlation,
    x="date",
    y=["CSI 300 / Hang Seng", "CSI 300 / S&P 500", "Hang Seng / S&P 500"],
    title="36-month rolling correlation of CNY price-index returns",
)
```

The full-sample matrix compresses eleven years into one number. Rolling estimates show whether the relationship changes across
periods. Because the windows overlap heavily, adjacent points are not independent pieces of evidence; do not invent a new market
mechanism for every rise and fall.

## Step 5: Express uncertainty with a block bootstrap

Resampling individual months destroys temporal order. The code below fixes its seed and resamples contiguous 12-month blocks,
retaining some short-run dependence. Block length is a method choice, not an objective truth. Nearby reasonable lengths are a
sensitivity check, not a menu from which to select the most attractive interval.

```python
def block_bootstrap_correlation(
    frame: pd.DataFrame,
    left: str,
    right: str,
    block_length: int = 12,
    resamples: int = 5000,
    seed: int = 20260825,
) -> pd.Series:
    paired = frame[[left, right]].dropna().to_numpy()
    observation_count = len(paired)
    if observation_count < block_length * 2:
        raise ValueError("Sample is too short for the chosen block length")

    random = np.random.default_rng(seed)
    block_count = int(np.ceil(observation_count / block_length))
    maximum_start = observation_count - block_length + 1
    estimates = np.empty(resamples)

    for sample_index in range(resamples):
        starts = random.integers(0, maximum_start, size=block_count)
        indices = np.concatenate(
            [np.arange(start, start + block_length) for start in starts]
        )[:observation_count]
        sample = paired[indices]
        estimates[sample_index] = np.corrcoef(sample[:, 0], sample[:, 1])[0, 1]

    return pd.Series(
        {
            "estimate": np.corrcoef(paired[:, 0], paired[:, 1])[0, 1],
            "ci_low": np.quantile(estimates, 0.025),
            "ci_high": np.quantile(estimates, 0.975),
            "observations": observation_count,
            "block_months": block_length,
        }
    )


correlation_intervals = pd.DataFrame(
    {
        "CSI 300 / Hang Seng": block_bootstrap_correlation(
            returns, "csi300_cny", "hsi_cny"
        ),
        "CSI 300 / S&P 500": block_bootstrap_correlation(
            returns, "csi300_cny", "spx_cny"
        ),
        "Hang Seng / S&P 500": block_bootstrap_correlation(
            returns, "hsi_cny", "spx_cny"
        ),
    }
).T

correlation_intervals.round(3)
```

A wide interval means the finite sample cannot locate correlation precisely. It is not a statement that 95% of future
correlations will fall inside the interval, and it does not automatically fix structural breaks, extreme months, or data selection.

## Write the conclusion

Use this structure in the final Markdown Cell, replacing brackets with actual output:

```text
In the fixed complete common sample from 2015-01 through 2025-12, the three pairs of monthly CNY price-index
returns had correlations of [...]. Their 36-month rolling ranges were [...], showing [...]. The 95% intervals
from a 12-month block bootstrap were [...]; the least precise relationship was [...].

The evidence supports / does not support the statement that historical correlations were materially below 1,
but it cannot establish stable future diversification. Price indices exclude dividends, CNY conversion is not
ETF return, and the exercise omits fees, tracking error, taxes, and rebalancing costs. A tradable follow-up should
use explicit ETF proxies, freeze a rebalancing rule, and add costs and an out-of-sample period.
```

Do not reduce the result to “correlation is low, therefore buy.” Preserve disagreement among the full sample, rolling windows,
and uncertainty intervals when it exists.

## Completion check

- [ ] The first Markdown Cell states the question, prior, falsification condition, and sample before execution.
- [ ] Code uses stable IDs, `market.cny_close`, and complete monthly observations.
- [ ] Output records common-sample dates, count, and FX identity errors.
- [ ] The study reads full-sample, rolling, and block-bootstrap evidence together.
- [ ] The conclusion separates price indices from ETFs and historical description from future judgment.
- [ ] The full document runs in a clean environment and is promoted to an immutable research version.

Completing every item shows that you can retain an auditable cross-market study. It does not prove that a three-market allocation
has positive returns after costs.

## Next steps

- [CSI 300 trend strategy: parameters, costs, and out-of-sample evidence](/help/learning/csi300-trend-strategy)
- [Research documents and run records](/docs/help/research/records)
- [Read research outputs](/docs/help/research/outputs)
- [How to read a time-series relationship study](/docs/help/basics/time-series-relationships)
- [Return and risk metrics](/docs/help/basics/performance-risk)
