# Use the Research Python runtime

Python Cells run in the fixed `research-py-v1` environment. A fixed environment keeps major dependencies consistent across reruns instead of installing an unknown set of package versions for each study.

## Available packages

| Package | Suitable tasks |
| --- | --- |
| NumPy | Arrays, linear algebra, vectorized computation, and simulation |
| pandas | Table preparation, joins, grouping, rolling windows, and date alignment |
| SciPy | Distributions, hypothesis tests, optimization, signal processing, and numerical routines |
| statsmodels | Regression, HAC covariance, time-series models, stationarity tests, and diagnostics |
| Matplotlib | Custom static figures that native product charts cannot express |
| scikit-learn | Preprocessing, model selection, covariance estimation, and classical machine learning |

NumPy is preloaded as `np`, and pandas is preloaded as `pd`. Import other packages by their standard names. The editor provides assistance for commonly used SciPy and statsmodels interfaces.

## Run a statistical test

1. Load and inspect data through a platform `data.*` method.
2. Handle missing values, align dates, and fix the analysis sample explicitly.
3. Import an existing test or estimator from the fixed packages instead of hand-writing p-values, regressions, or optimizers.
4. Run the Cell and record the sample size, statistic, interval, and hypothesis direction.
5. Explain limitations in an adjacent Markdown Cell instead of copying only one p-value.

```python
from scipy import stats
import statsmodels.api as sm

clean = sample[["x", "y"]].dropna()
t_stat, p_value = stats.ttest_1samp(clean["x"], popmean=0.0)
model = sm.OLS(clean["y"], sm.add_constant(clean["x"])).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": 2},
)
print({"n": len(clean), "t": t_stat, "p": p_value})
model.summary()
```

![SciPy and statsmodels output in the fixed runtime](/docs/images/help/zh/research/python-runtime-01.png)

## Choose a chart surface

Prefer `charts.*` for line, scatter, bar, histogram, and heatmap output because these charts support hover and zoom in the page. Use Matplotlib only when a native chart cannot express the figure.

The current Matplotlib environment includes DejaVu Sans but no CJK font. Keep Matplotlib titles, axes, legends, and annotations in concise English. Markdown explanations and console text may still use Chinese.

## Unsupported actions

- A Cell cannot run `pip install` or add packages at runtime.
- It cannot access host directories, secrets, or arbitrary external networks.
- Imports outside the allowed list fail before or during execution.
- Do not reimplement a mature statistical method to bypass a missing package; recording the capability gap is more reliable.
- When using scikit-learn, prespecify training, validation, and test periods so future data cannot leak into training.

## When a capability is missing

First verify the import name and editor assistance. If the package is not in the current runtime, record the missing capability and its effect in Markdown. Do not ask the Agent to substitute a similarly named method with different statistical meaning.

## Related articles

- [Read research outputs](/docs/help/research/outputs)
- [Load US Treasury yield curves](/docs/help/research/yield-curves)
- [How to read a multivariate time-series study](/docs/help/basics/multivariate-time-series-relationships)
