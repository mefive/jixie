# How to read an event study

An event study aligns many public events to an “event day” and examines whether entity returns around the event differ from a market benchmark. The current protocol supports records with `divProc = 预案` in the local dividend dataset and an explicitly specified stock set.

## Event day and window

The announcement date maps to that day or the first trading day after it, labeled day 0. `[-5, 5]` spans five trading days before through five after the event day, producing eleven return observations.

Local announcements have dates but no pre-market, intraday, or after-market timestamps. Day 0 therefore cannot precisely identify when the information first became tradable. This limitation must remain attached to the conclusion.

## AR, CAR, and CAAR

The market-adjusted model subtracts the same-day benchmark return from the entity return:

$$
AR_{i,\tau}=R_{i,\tau}-R_{m,\tau}
$$

One event's cumulative abnormal return over a window is:

$$
CAR_i[a,b]=\sum_{\tau=a}^{b}AR_{i,\tau}
$$

The cumulative average abnormal return across $N$ events is:

$$
CAAR[a,b]=\frac{1}{N}\sum_{i=1}^{N}CAR_i[a,b]
$$

The event-time path shows the average abnormal return at each relative trading day and CAAR through that day. Accumulation before day 0 may indicate anticipation, leakage, a common trend, or event-date error.

## How the sample is formed

1. Keep proposal announcements inside the research period.
2. For duplicate proposal records for one stock and reporting period, keep the earliest announcement.
3. Exclude an event if either entity or benchmark is missing any return in its window.
4. When two windows overlap for one stock, keep the earlier event so the same return interval is not counted twice.

The sample-selection tab reports requested entities, in-period events, complete windows, overlap exclusions, and final observations so the selection process can be audited.

## Intervals, magnitude, and robustness

The workbench treats each event CAR as one event-level observation and clusters the mean-CAR standard error, t-statistic, and 95% interval by event trading date, allowing same-day announcements to share market shocks. Standardized mean CAR describes effect magnitude. A 5% winsorized mean CAR checks whether a few extreme events drive the direction.

This interval still does not automatically address industry concentration or serial dependence across events for the same stock.

## Python teaching example

```python
import numpy as np
import statsmodels.api as sm

# rows: one row per event; columns: relative trading days
abnormal = stock_returns - benchmark_returns
event_car = abnormal.sum(axis=1)
caar_path = abnormal.cumsum(axis=1).mean(axis=0)

mean_car = event_car.mean()
fit = sm.OLS(event_car, np.ones((len(event_car), 1))).fit(
    cov_type="cluster",
    cov_kwds={"groups": event_trade_dates},
    use_t=True,
)
confidence_interval = fit.conf_int(alpha=0.05)[0]
```

## Limits on conclusions

- Market-adjusted abnormal return is not a causal counterfactual. Concurrent company news, industry moves, and event selection can confound the result.
- An announcement may already be anticipated. A return around it does not establish that a trade is feasible.
- Repeatedly changing the window, entity set, or dates after inspecting results creates multiple-testing bias.
- The current model subtracts one market benchmark; it does not control industry, size, value, or other concurrent risk exposures.

## Further reading

- [SciPy t distribution](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html)
- [How to read a two-group distribution comparison](/docs/help/basics/distribution-comparison)
- [How to read a time-series relationship study](/docs/help/basics/time-series-relationships)
