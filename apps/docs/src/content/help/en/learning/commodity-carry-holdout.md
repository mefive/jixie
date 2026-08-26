# Commodity carry: term structure, proxy error, and holdout evidence

This path studies a familiar claim that is often stated too casually: **do commodities earn higher future returns when their
futures curves are in backwardation?** You will use actual delivery contracts for AU gold, CU copper, SC crude oil, and M soybean
meal, run both a common-month-end Panel ranking and per-commodity time-series tests, and seal both formal holdouts before seeing
either new result.

The value of this case is not a tradable rule. Both preregistered criteria failed in the first holdout from February 5, 2025 through
July 30, 2026. The exercise shows how to retain a failure and why a researcher cannot switch after the reveal among Rank IC,
cost-adjusted long-short return, and individual-asset t-statistics.

## Start with the actual verdict

| Preregistered question | Explore | Formal holdout | Primary criterion | Verdict |
| --- | ---: | ---: | --- | --- |
| Common-month-end cross-sectional ranking | Rank IC 0.0186 | Rank IC **-0.0471** | `panel_rank_ic_mean > 0` | Missed |
| Per-commodity time-series relation | median t 1.524 | median t **0.520** | `median_newey_west_t > 1.96` | Missed |

The Panel holdout nevertheless reported a 25.43% annualized net long-short return. That metric was not the primary criterion. With
only 17 months and at most four assets per month, Top-minus-Bottom returns can be dominated by a few large magnitudes, while Rank IC
tests the complete ordering. The conflict must remain visible; the better-looking metric cannot replace the frozen verdict.

## What you will learn

After this exercise, you should be able to:

1. explain carry from actual near and far settlements without treating a main-contract code switch as return;
2. distinguish a cross-sectional question from a time-series question;
3. freeze two primary criteria before reveal while keeping four asset-level estimates diagnostic;
4. explain why overlapping 20-day targets require Newey–West standard errors;
5. identify proxy error among commodity futures, spot or physical ETFs, futures ETFs, and category ETFs;
6. reject a universal rule when direction reverses out of sample and metrics conflict.

## Step 1: define carry without calling it realized return

On each date, the platform selects the nearest two distinct delivery months that remain at least ten days from delivery and have
positive volume and open interest. It then computes:

$$
C_t = \ln\left(\frac{F_{near,t}}{F_{far,t}}\right)
      \times \frac{365}{D_{far}-D_{near}}
$$

$F$ is the settlement price and $D$ is the delivery date. $C_t>0$ means backwardation and $C_t<0$ means contango. Settlement is
known only after the futures close, so the feature becomes available on the next SSE trading day. A same-day ETF close cannot use a
curve that had not yet been published.

This annualized log-curve feature is not:

- realized roll profit for that day;
- the jump produced by directly joining an old main contract to a new one;
- a return including collateral yield, commissions, impact, and an executable roll policy;
- a quantity that can be added to the main-continuous return and relabeled total return.

## Step 2: audit the four research proxies

| Futures product | Proxy ETF | Question this case can answer | Main proxy limit |
| --- | --- | --- | --- |
| AU gold | `518880.SH` gold ETF | Relation between the gold curve and a CNY gold proxy | The ETF is closer to domestic spot gold, not an AU futures portfolio |
| CU copper | `159980.SZ` non-ferrous futures ETF | Relation between copper carry and a non-ferrous category proxy | The ETF does not hold only copper |
| SC crude oil | `159981.SZ` energy and chemicals futures ETF | Relation between crude carry and an energy-chemical category proxy | The ETF does not hold only SC and its product weights can change |
| M soybean meal | `159985.SZ` soybean-meal futures ETF | Relation between soybean-meal carry and futures-ETF return | The ETF still has its own contract selection, roll, fees, and tracking error |

Actual futures contracts generate the feature; future returns come from ETFs. This page does not enable commodity-futures orders,
margin backtests, or treating Tushare's main-contract mapping as an execution roll instruction.

## Step 3: freeze two different questions before reveal

History through January 27, 2025 had already been used for exploration and cannot be presented as first-time out-of-sample data.
This exercise treats only February 5, 2025 through July 30, 2026 as unrevealed. Both tests are registered before either holdout is
read.

The Panel hypothesis says that the higher-carry product at a common month end should rank higher on next-period return:

```json
{
  "mode": "hypothesis",
  "expectedDirection": "positive",
  "primaryCriterion": {
    "metric": "panel_rank_ic_mean",
    "operator": "gt",
    "value": 0
  }
}
```

The time-series hypothesis says that, within each product, higher carry should accompany a higher next-20-trading-day return. The
median Newey–West t-statistic across the four assets must exceed 1.96:

```json
{
  "mode": "hypothesis",
  "expectedDirection": "positive",
  "primaryCriterion": {
    "metric": "time_series_median_newey_west_t",
    "operator": "gt",
    "value": 1.96
  }
}
```

These are two preregistered tests, not two views of one test. The ledger therefore records two unique test keys and 0.10 expected
false positives under simple five-percent accounting. That number is a warning, not a Bonferroni or FDR correction and not proof
that the tests are independent.

## Step 4: read exploration without rewriting the hypothesis

The Panel uses January 1, 2015 through January 27, 2025, common month ends, next-20-trading-day total return, ten basis points of
cost per side, and at least three eligible assets. Across 59 months and 294 observations, mean Rank IC was 0.0186, annualized ICIR
0.129, positive-IC frequency 49.15%, net long-short annualized return 5.10%, and average one-way turnover 46.61%. This is weak and
conflicting exploratory evidence, not a universal carry rule.

![Actual commodity-carry Panel exploration report](/docs/images/help/zh/learning/commodity-carry-panel-explore-result.png)

The time-series test uses daily observations over the same historical period and a 20-trading-day forward return. Those targets
overlap heavily, so the automatic Newey–West lag is at least 19. The 6,069 observations are not 6,069 independent experiments.

| Proxy ETF | Observations | Correlation | Newey–West t | Direction hit rate |
| --- | ---: | ---: | ---: | ---: |
| Gold | 2,428 | 0.0788 | 2.283 | 45.64% |
| Non-ferrous | 1,215 | 0.1294 | 1.563 | 51.00% |
| Energy and chemicals | 1,198 | -0.1128 | -2.001 | 43.67% |
| Soybean meal | 1,228 | 0.1091 | 1.484 | 50.12% |

The median t-statistic is 1.524. Energy and chemicals has the opposite sign, while gold's positive t-statistic accompanies a hit
rate below 50%. Neither one nominally strong estimate nor a three-positive/one-negative count proves a universal commodity effect.

![Actual commodity-carry time-series exploration report](/docs/images/help/zh/learning/commodity-carry-time-series-explore-result.png)

## Step 5: seal both reports before revealing either

Both exploration reports preserve the exact Factor code hash, assets, dates, 20-day target, point-in-time cutoff, and primary
criterion. The formal sequence is:

1. create the Panel holdout and let it finish without exposing payload, metrics, or logs;
2. create the time-series holdout and verify the same seal;
3. reveal each report once only after both sealed reports exist;
4. verify that a repeated request returns the same `revealedAt` rather than a new result.

This prevents the first method's holdout from changing the second method's criterion. It does not remove dependence from shared
assets and dates, so the final verdict must remain more conservative than a count of two p-values.

## Step 6: both formal holdouts reject the universal rule

The Panel holdout contains 17 eligible months and 68 observations. Mean Rank IC changed from 0.0186 to -0.0471, ICIR from 0.129
to -0.219, and positive-IC frequency was only 47.06%. The preregistered positive-direction criterion failed.

![Actual commodity-carry Panel holdout report](/docs/images/help/zh/learning/commodity-carry-panel-holdout-result.png)

| Panel metric | Explore | Holdout | Interpretation |
| --- | ---: | ---: | --- |
| Mean Rank IC | 0.0186 | **-0.0471** | Ranking direction reversed; primary criterion failed |
| Annualized ICIR | 0.129 | -0.219 | Ranking stability did not improve |
| Positive Rank IC frequency | 49.15% | 47.06% | Fewer than half of months were positive |
| Net long-short annualized | 5.10% | **25.43%** | Conflicts with ranking evidence and cannot replace the primary criterion |
| Average one-way turnover | 46.61% | 64.71% | The holdout portfolio construction was less stable |

Each time-series holdout has 343 observations. The four t-statistics are 1.143, 1.571, -1.048, and -0.103; their median is only
0.520, far below 1.96. Gold and non-ferrous remain weakly positive, energy remains negative, and soybean meal changes from positive
to slightly negative.

![Actual commodity-carry time-series holdout report](/docs/images/help/zh/learning/commodity-carry-time-series-holdout-result.png)

| Proxy ETF | Explore correlation / t | Holdout correlation / t | Holdout direction hit rate |
| --- | ---: | ---: | ---: |
| Gold | 0.0788 / 2.283 | 0.0659 / 1.143 | 40.52% |
| Non-ferrous | 0.1294 / 1.563 | 0.1212 / 1.571 | 54.27% |
| Energy and chemicals | -0.1128 / -2.001 | -0.0985 / -1.048 | 49.27% |
| Soybean meal | 0.1091 / 1.484 | -0.0203 / -0.103 | 53.80% |

## Step 7: write a verdict that cannot be rescued after the fact

```text
Research verdict: the evidence does not support positive carry as one shared ETF-ranking or
timing rule across these four commodities.

Primary evidence: Panel holdout mean Rank IC was -0.0471 and missed the frozen >0 criterion.
The time-series holdout median Newey–West t-statistic was 0.520 and missed >1.96.

Conflicting evidence: Panel holdout net long-short return annualized to 25.43%, but it was not
the primary criterion and came from a four-asset Top-minus-Bottom construction over 17 months.
It cannot override the reversal in complete ordering.

Limits: CU and SC use category ETFs; even the AU and M proxies are not executable futures
portfolios. Results exclude collateral yield, executable rolling, impact, and capacity. The two
tests share assets and dates and are not fully independent evidence.

Action: retain both failed holdouts, publish no Factor, and enable no commodity-futures trading.
Any continuation must state a product-specific inventory, warehouse-receipt, or curve hypothesis
with a new prior criterion and genuinely unseen data, not retune this window.
```

## Completion checklist

- [ ] You can write the carry formula and explain why positive means backwardation.
- [ ] You do not confuse carry proxy, roll gap, continuous return, and realized futures P&L.
- [ ] You can identify which ETFs are weak one-to-one category proxies.
- [ ] Panel and time-series questions are recorded as two tests, not two tabs of one result.
- [ ] Both holdouts were sealed before either reveal.
- [ ] You know why overlapping 20-day targets require at least lag 19 in Newey–West inference.
- [ ] You did not replace failed Rank IC with the Panel's 25.43% long-short return.
- [ ] You did not turn weak gold or non-ferrous evidence into a universal four-product rule.
- [ ] The final conclusion retains holdout failure, multiple testing, and proxy error.
- [ ] No Factor was published and no commodity-futures execution capability was enabled.

## Related articles

- [Run cross-asset Panel research](/help/factors/panel-research)
- [Run ETF time-series research](/help/factors/time-series-research)
- [Research card and exploratory variants](/help/factors/research-card)
- [Formal holdout and out-of-sample results](/help/factors/holdout-results)
- [Turnover, transaction costs, and net returns](/help/factors/turnover-costs)
- [Backtest stock-index futures](/help/backtesting/index-futures)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
