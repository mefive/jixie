# How to read a time-series relationship study

A time-series relationship study compares two variables ordered through time. Examples include whether monthly changes in a
10-year government yield move with CSI 300 monthly returns, or whether the gold-equity correlation changes over time. It
describes a relationship in the historical sample; it does not by itself establish causality or a predictive signal.

## Check the variables and timing first

Before reading the statistics, verify five items:

1. **Variables:** Are they levels, returns, differences, or year-over-year changes? What are their units?
2. **Frequency:** Daily and monthly observations cannot be mixed directly. Monthly observations align by calendar month, even
   when two markets have different last trading days.
3. **Partial periods:** An unfinished current month is excluded by default. Include it only for an explicit month-to-date study.
4. **Lag:** `predictorLag = 0` is contemporaneous. A positive lag places the predictor before the outcome.
5. **Sample:** An inner join keeps only periods observed for both variables. Check the count, first and last dates, and missingness.

## What Pearson and Spearman measure

Pearson correlation measures a linear relationship:

$$
r_{xy}=\frac{\sum_{t=1}^{T}(x_t-\bar{x})(y_t-\bar{y})}
{\sqrt{\sum_{t=1}^{T}(x_t-\bar{x})^2}\sqrt{\sum_{t=1}^{T}(y_t-\bar{y})^2}}
$$

It ranges from −1 to 1. Positive values indicate co-movement, negative values indicate opposite movement, and a larger absolute
value indicates a clearer linear relationship in the sample. A value near zero does not rule out a nonlinear or state-dependent
relationship.

Spearman first replaces values with ranks and then correlates the ranks. It asks whether one variable tends to rise when the other
rises and is less sensitive to extreme magnitudes than Pearson. A large gap between the two calls for checks of outliers,
nonlinearity, and market states.

## Regression slope, interval, and R²

The simple regression is:

$$
y_t=\alpha+\beta x_{t-k}+\varepsilon_t
$$

- `β` is the slope: the sample-average change in `y` for a one-unit change in `x`. Its interpretation must include the units.
- `α` is the intercept and may not have an economic interpretation.
- A 95% confidence interval describes estimation uncertainty under the model assumptions. Excluding zero is statistical evidence,
  not evidence of investment value.
- R² is the share of in-sample variation explained by the line. A high R² may simply reflect common exposure to a market factor.

Financial time series often have heteroskedasticity and serial dependence. The workbench uses Newey–West/HAC standard errors for
slope uncertainty. HAC changes the standard error, t-statistic, and interval, not the OLS slope. It does not fix omitted variables,
common trends, structural breaks, or an incorrect time direction.

## Why inspect rolling estimates

A full-sample correlation can hide changing regimes. Rolling correlations and slopes repeatedly estimate the relationship over a
fixed window. They show sign changes, isolated episodes, and dependence on a few months. Short windows react faster but are
noisier; long windows are smoother but can hide structural change.

## Python teaching example

This illustrates the same calculation. The production result remains defined by the versioned protocol, data semantics, and
parameters shown in the workbench.

```python
import pandas as pd
import statsmodels.api as sm

aligned = pd.concat([predictor, outcome], axis=1, join="inner").dropna()
x = sm.add_constant(aligned["predictor"])
fit = sm.OLS(aligned["outcome"], x).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": hac_lag},
)
pearson = aligned["predictor"].corr(aligned["outcome"], method="pearson")
spearman = aligned["predictor"].corr(aligned["outcome"], method="spearman")
```

## Limits on conclusions

- A contemporaneous relationship cannot be described as “X predicts Y.” Prediction requires X to precede a future Y.
- Correlation and a significant regression do not establish causality.
- Statistical significance is not net-of-cost tradability and does not guarantee persistence.
- Trying many dates, windows, lags, or variables and reporting only the best result creates multiple-testing bias.
- Two trending level series can be spuriously correlated. Differences, returns, trends, or cointegration may be required.

## Further reading

- [SciPy statistical functions: Pearson and Spearman](https://docs.scipy.org/doc/scipy/reference/stats.html)
- [statsmodels HAC robust covariance](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [ETF time-series factor research](/docs/help/factors/time-series-research)
