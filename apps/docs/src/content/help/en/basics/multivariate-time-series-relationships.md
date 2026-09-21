# How to read a multivariate time-series study

A two-variable relationship can be mixed with a third variable. Gold returns and changes in real yields, for example, may both vary with the inflation environment. A multivariate study places one outcome and several prespecified explanatory dimensions in the same model:

$$
y_t=\alpha+\beta_f x_{f,t-k_f}+\sum_{j=1}^{q}\gamma_j c_{j,t-k_j}+\varepsilon_t
$$

Here `y` is the outcome, `x_f` is the single focal predictor, and `c_j` are controls. Each predictor can have its own lag.

## Use this method in the current product

State the question and method in [Research](/research), load inputs through the [data catalog](/docs/help/research/data-catalog), and explicitly implement alignment, statistics, and charts in Python Cells. You can also use [embedded analysis](/docs/help/research/embedded-analysis) in a Factor or Strategy conversation. The methods below are choices to review, not a promise that the platform automatically runs every test or creates fixed report tabs. Check the code, inputs, and outputs of the actual run.

## Why prespecify one focal predictor

The model can estimate every coefficient. To limit post-hoc selection, prespecify one primary question, such as:

> After controlling for CPI, are changes in real yields negatively related to monthly gold returns?

Real yield is focal and CPI is a control. Formally testing CPI after controlling for real yields requires a separate run that names CPI as focal before results are inspected. Record this discipline explicitly in the document; free-form Python does not automatically enforce it.

Controls must also be prespecified from research logic rather than automatically added or removed by significance. More variables are not always better: the common sample can shrink and collinearity can destabilize coefficients.

## Raw coefficients, standardized coefficients, and partial R²

- A **raw coefficient** retains units. Use it to interpret the outcome change associated with one unit of a predictor.
- A **standardized coefficient** uses standard-deviation units, making sample-scale comparisons across differently measured predictors easier. It does not make the relationship causal.
- **Partial R²** is the share of remaining variation additionally explained by one predictor after all the others are included:

$$
R^2_{partial,j}=\frac{SSE_{-j}-SSE_{full}}{SSE_{-j}}
$$

A tiny partial R² with an interval excluding zero can be statistically distinguishable but still have little incremental explanatory power. Adjusted R² penalizes the full model for its predictor count and is more informative than raw R² when model dimensions differ.

Report partial R² numerically and explain its economic meaning. If using labels such as small or large, state the thresholds before calculating. Free-form research does not automatically assign a universal grade.

## What the “relationship after controls” chart shows

In Python, remove the linearly fitted effect of controls from both the outcome and focal predictor, then compare the residuals in a scatter plot. By the Frisch–Waugh–Lovell theorem, its slope is the focal coefficient in the full model.

This makes the conditional relationship visible. It removes only the linear contribution of included controls and cannot eliminate omitted variables or reverse directionality.

## VIF and the predictor correlation matrix

When predictors are highly related, the model struggles to distinguish which one contributes the relationship. The variance inflation factor is:

$$
VIF_j=\frac{1}{1-R_j^2}
$$

`R_j²` comes from regressing predictor j on all other predictors. VIF near 1 indicates little collinearity. If you choose 5 as a diagnostic threshold, explicitly calculate and display that warning in code. A high VIF is not a mechanical instruction to delete a variable. It means coefficients and signs may be sample-sensitive, so the research rationale should determine whether variables duplicate a concept.

The correlation matrix displays pairwise Pearson correlations among predictors. It identifies obvious duplication but does not replace VIF because combinations of several predictors can also be collinear.

## HAC intervals, residuals, and rolling coefficients

You can apply Newey–West/HAC standard errors to every coefficient in Python and record the lag choice. HAC adjusts intervals for heteroskedasticity and finite-order serial dependence. It does not change OLS coefficients and cannot repair wrong variables, common trends, or structural breaks.

High lag-1 residual autocorrelation suggests missing dynamics. Rolling focal coefficients repeatedly estimate the focal partial coefficient in a fixed window to show whether its direction holds across periods. Very short windows are noisy for multivariate estimation.

## Python teaching example

This assumes an SDK-derived `sample` table with aligned frequency and definitions, plus a specified `hac_lag`. Document sample construction, lags, and missing-value handling first. Use `sample` for the DataFrame so the platform's `data` access object remains intact.

```python
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor

aligned = sample[["gold_return", "real_yield_change", "cpi_yoy"]].dropna()
X = sm.add_constant(aligned[["real_yield_change", "cpi_yoy"]])
fit = sm.OLS(aligned["gold_return"], X).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": hac_lag},
)

coefficient_table = fit.summary2().tables[1]
vif = pd.Series(
    [variance_inflation_factor(X.values, i) for i in range(1, X.shape[1])],
    index=X.columns[1:],
)
```

## Limits on conclusions

- “After controlling for CPI” means controlling for that exact CPI series and transform, not every form of inflation expectations.
- A contemporaneous multivariate regression does not establish prediction; predictors must be available before a future outcome.
- Controlling observed variables reduces some confounding but does not create a causal conclusion.
- Repeatedly changing focal variables, controls, lags, and windows on the same data creates multiple-testing bias.
- If macro history uses later revisions, the study describes the revised historical relationship and cannot claim to reproduce the real-time information set.

## Further reading

- [statsmodels OLS](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLS.html)
- [statsmodels HAC robust covariance](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [statsmodels variance inflation factor](https://www.statsmodels.org/stable/generated/statsmodels.stats.outliers_influence.variance_inflation_factor.html)
- [How to read a bivariate time-series relationship study](/docs/help/basics/time-series-relationships)
