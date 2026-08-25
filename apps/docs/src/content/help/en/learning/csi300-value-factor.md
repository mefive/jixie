# CSI 300 value factor: ranking, IC, portfolios, and holdout

> Learning path · About 75–105 minutes · Run one preset Factor analysis first. This exercise uses an existing preset and its reports,
> so no code is required.

This exercise tests one limited cross-sectional question: **Among the point-in-time constituents of the CSI 300, do stocks with
higher earnings yield tend to rank higher by next-month return, and does that relationship remain in a frozen formal holdout?**

The earnings-yield preset has key `ep` and is the reciprocal of positive `PE_TTM`. It converts “which stocks are relatively cheaper
at the same time” into a sortable value. It does not create positions or prove that cheap stocks will rise.

## The fixed case has been run for real

The first real run corrected a date that made the original tutorial impossible to execute. The local CSI 300 point-in-time membership
history begins with a 2016-01-29 snapshot, and the system correctly refuses to backfill 2015 with today’s constituents. The fixed
explore window therefore starts on **2016-02-01**; the date was not moved to improve the result.

On 2026-08-25 a new account ran the non-neutralized primary report, the predeclared size-plus-industry-neutralized diagnostic, and the
primary report’s one formal holdout. Explore data were cut off at 2025-01-27 and produced 107 valid months. Holdout ran from
2025-02-05 through 2026-07-30 and produced 17 valid months. Every report froze point-in-time CSI 300 membership, monthly frequency,
global ranking, 1% winsorization, nonzero costs, and `mean Rank IC > 0.02`.

| Report | Rank IC | Newey–West 95% interval | Annualized ICIR | IC>0 | Net L/S annualized | D10 turnover |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Primary explore | 0.0521 | [0.0099, 0.0943] | 0.744 | 56.1% | -4.53% | 17.5% |
| Size + industry diagnostic | 0.0448 | [0.0180, 0.0717] | 1.160 | 60.7% | 5.01% | 29.4% |
| Formal holdout | 0.0734 | [-0.0801, 0.2269] | 0.699 | 52.9% | -19.07% | 17.7% |

![Actual primary earnings-yield report for point-in-time CSI 300 constituents](/docs/images/help/zh/learning/csi300-value-factor-explore-result.png)

![Actual size-plus-industry-neutralized diagnostic](/docs/images/help/zh/learning/csi300-value-factor-neutralized-result.png)

![Actual first reveal of the formal holdout](/docs/images/help/zh/learning/csi300-value-factor-holdout-result.png)

Holdout exceeded the precommitted Rank IC threshold, but its 95% interval includes zero, only 52.9% of months were positive, and net
long-short annualized return was -19.07%. Passing one threshold is not success; the fixed adjudication is **insufficient evidence**.
The report also states that historical negative-equity and long-suspension states cannot be reliably backfilled, and the system did
not substitute current status for history. The screenshots retain these warnings and conflicting evidence.

## What you will learn

You should be able to:

1. explain the earnings-yield direction, missing-value rule, and research population;
2. distinguish Factor values, forward returns, Rank IC, decile returns, and long-short diagnostics;
3. freeze the research universe, primary criterion, and one sensitivity check before viewing results;
4. read coverage, robust intervals, turnover, costs, and conflicting holdout evidence;
5. finish with advance, insufficient evidence, or rejection instead of automatically publishing a Factor or building a strategy.

## Prerequisites

- If you have not run a Factor before, first [run your first preset Factor analysis](/help/factors/first-preset-analysis).
- Read [What Factor research can answer](/help/factors/what-factor-research) and [Pre-run research cards](/help/factors/research-card).
- If rank correlation is unfamiliar, read [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir).
- This exercise includes one irreversible holdout reveal. Data already viewed here or elsewhere cannot become unobserved again.

## Step 1: Understand exactly what the preset computes

Open Factors, choose Factor Library, and select “Earnings yield (1/PE_TTM).” The preset computes:

$$
EP_{i,t}=
\begin{cases}
1/PE^{TTM}_{i,t}, & PE^{TTM}_{i,t}>0 \\
\text{missing}, & PE^{TTM}_{i,t}\leq0\text{ or unavailable}
\end{cases}
$$

Therefore:

- a larger value means cheaper under positive trailing P/E, so the prior direction is positive;
- loss-making stocks and stocks without available `PE_TTM` are not forced into the “cheapest” end—they have no exposure that period;
- earnings yield is a relative ranking signal, not a complete estimate of intrinsic value;
- `PE_TTM`, prices, and membership must be available at that historical date; current membership must not be backfilled.

For example, if three positive-P/E stocks have `PE_TTM` of 10, 20, and 40, their earnings yields are 0.10, 0.05, and 0.025. The
first ranks higher, but a higher rank does not mean it must rise next month. The study examines an average ranking relationship across
many stocks and months.

## Step 2: Freeze the research card and protocol before viewing results

When the workspace opens without a selected report, the platform sets the end date to the current **explore-period end**. That date
moves as server data updates, so do not copy an old screenshot date. In More settings, enter the protocol below and record the actual
dates, costs, and data cutoff shown on your page:

| Item               | Primary report for this exercise                                                  | Why it is frozen                                                    |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Factor             | `ep` earnings-yield preset                                                        | Do not edit the code or definition                                  |
| Research universe  | CSI 300                                                                           | Use index membership as it stood on each historical date            |
| Ranking scope      | Global                                                                            | Compare the CSI 300 constituents with one another                   |
| Frequency          | Monthly                                                                           | Relate the Factor value to next-month return                        |
| Range              | `2016-02-01` through the current explore-period end shown by the page             | First membership snapshot is 2016-01-29; do not cross the holdout   |
| Neutralization     | None                                                                              | This is the precommitted primary report                             |
| Sample handling    | Keep the current default risk, liquidity, coverage, and 1% winsorization settings | Avoid changing filters after viewing results                        |
| Costs              | Keep the current nonzero defaults and record their exact values                   | Do not interpret the net long-short result as frictionless          |
| Primary criterion  | Mean Rank IC `> 0.02`                                                             | A preregistered exercise threshold, not a universal industry cutoff |
| Planned diagnostic | One additional size-plus-industry-neutralized report                              | Check whether size or industry largely explains the result          |

Click Run analysis, select Hypothesis test, and enter:

```text
Hypothesis: Among point-in-time CSI 300 constituents, stocks with higher earnings yield tend to rank
            above stocks with lower earnings yield by next-month return.

Rationale: Lower valuation may correspond to a higher required subsequent return, but the pattern may
           instead reflect distress, industry, or size exposure.

Expected direction: Positive.
Primary criterion: Mean Rank IC > 0.02.

Supporting evidence: approximate D1-to-D10 monotonicity, the Newey–West interval for IC, ICIR,
                     the share of positive IC periods, equal- versus market-cap-weighted results,
                     coverage, turnover, and net long-short results.

Falsification: do not call the candidate robust if the formal holdout misses the primary criterion,
               the direction reverses, deciles are disorderly, the robust interval crosses zero,
               or the result largely disappears after size-plus-industry neutralization,
               reasonable costs, or market-cap weighting.

Limits: historical stock cross-sections only. Do not publish automatically, generate a buy list,
        build a strategy, or deploy.
```

`0.02` gives this exercise one explicit ex ante criterion. Appropriate values vary across markets, frequencies, and Factors. Lowering
the threshold after a run to make it pass would rebrand exploration as validation.

## Step 3: Run the primary report and verify the sample first

Freeze the research card and run. When the report completes, do not start with the tallest return bar. Verify, in this order:

1. the header says CSI 300, monthly, no neutralization, and the intended date range;
2. the research-universe specification says point-in-time constituents;
3. the data cutoff, valid months, and actual analysis years match the plan;
4. changes in sample size through universe, Factor exposure, forward price, listing-age, risk-status, and liquidity filters are sensible;
5. valid-stock coverage is stable rather than barely clearing the minimum in a few months;
6. the code hash, outlier handling, and per-side costs match the frozen card.

If the page says the current report still uses old parameters, the visible result does not represent the edited draft. Reopen the
correct historical report or run a new one with the new settings. Do not combine one result with another protocol.

Record the protocol in a fixed table:

| Report             | Universe | Range | Months | Neutralization  | Code hash | Data cutoff | Explore variants |
| ------------------ | -------- | ----- | -----: | --------------- | --------- | ----------- | ---------------: |
| Primary            | CSI 300  | […]   |    […] | None            | […]       | […]         |              […] |
| Planned diagnostic | CSI 300  | […]   |    […] | Size + industry | […]       | […]         |              […] |

Keep failed, interrupted, and contrary reports in history. The more variants you explore, the greater the chance of finding an
attractive result by accident.

## Step 4: Read Rank IC and decile returns as different evidence

For each formation month, the system computes the Spearman correlation between earnings-yield rank and next-month return rank:

$$
IC_t=\operatorname{Corr}_{Spearman}
\left(\operatorname{Rank}(EP_{i,t}),\operatorname{Rank}(r_{i,t\rightarrow t+1})\right)
$$

The primary report's mean Rank IC averages $IC_t$ across valid months. It asks whether high Factor ranks generally align with high
subsequent-return ranks. It is not a portfolio return and not a causal effect.

The report also sorts stocks from low to high Factor value into D1 through D10 every month:

- D1 is the lowest earnings-yield decile and D10 the highest;
- D10 is a group of stocks, not ten stocks recommended by the system;
- D10 minus D1 is a hypothetical long-high, short-low research construction;
- borrow availability, borrow fees, capacity, and impact for a real account are not fully represented by this diagnostic.

Read and record the primary report in this order:

| Evidence                            |    Record | Question                                                              |
| ----------------------------------- | --------: | --------------------------------------------------------------------- |
| Mean Rank IC                        |       […] | Does the sign match the prior, and does it exceed `0.02`?             |
| Newey–West 95% interval             |       […] | Does it include zero after allowing for time dependence?              |
| Annualized ICIR / positive-IC share | […] / […] | Is the average driven by only a few months?                           |
| Equal-weight D1→D10                 |       […] | Is the pattern broadly increasing rather than one extreme bar?        |
| Market-cap-weight D1→D10            |       […] | Does the order remain when larger stocks receive more weight?         |
| Gross / net long-short annualized   | […] / […] | Do basic frictions consume most of the spread?                        |
| D10 turnover / maximum drawdown     | […] / […] | What implementation burden and path risk does the construction imply? |
| Coverage and valid months           |       […] | Is the result built on stable, adequate cross-sections?               |

A mean above `0.02` does not erase conflicting evidence such as an interval that includes zero, disorderly deciles, or disappearance
under market-cap weighting. Conversely, tidy deciles with weak Rank IC may be driven by the tails or a small number of periods.

## Step 5: Run only the predeclared neutralization diagnostic

After recording the primary report, open More settings and change only neutralization from None to Size + industry. Keep every other
input unchanged. Reuse the same hypothesis, positive direction, and `Mean Rank IC > 0.02` research card. This becomes the second and
last explore report in the exercise.

The diagnostic asks whether the residual earnings-yield ranking still relates to next-month return rank after removing common
log-market-cap and historical-industry differences. It is not a switch for improving results and does not replace the primary report.

Record the two reports side by side:

| Metric                | Primary: no neutralization | Size + industry diagnostic | Interpretation                                                 |
| --------------------- | -------------------------: | -------------------------: | -------------------------------------------------------------- |
| Mean Rank IC          |                        […] |                        […] | How do direction and magnitude change?                         |
| Newey–West interval   |                        […] |                        […] | Which report still admits zero?                                |
| ICIR / positive share |                        […] |                        […] | Does stability change?                                         |
| D1→D10 order          |                        […] |                        […] | Do the middle groups remain ordered?                           |
| Net long-short        |                        […] |                        […] | Does the spread survive costs?                                 |
| D10 turnover          |                        […] |                        […] | Does neutralization materially increase implementation burden? |

Do not continue trying weekly frequency, within-industry ranking, different start dates, different winsorization, and multiple
thresholds until one combination looks best. Those may become future questions, but every choice adds an explore variant. This
exercise ends exploration with one primary report and one predeclared diagnostic.

## Step 6: Validate and reveal the formal holdout once

Return to the **non-neutralized primary report**. If it is eligible, the research-count bar shows Validate holdout. Before confirming,
verify:

1. the actual holdout start and end dates;
2. the frozen code hash belongs to the primary report;
3. the frozen protocol remains CSI 300, monthly, global ranking, and no neutralization;
4. the expected direction is still positive;
5. the primary criterion is still `Mean Rank IC > 0.02`.

After confirmation, the system computes with the primary report's saved code and non-date parameters. A completed result remains
sealed, and logs do not leak its metrics. Click Reveal results only when you are ready to accept success or failure. The first reveal
time is permanently recorded and cannot be undone.

If the button is unavailable, record the displayed reason verbatim:

- the explore report did not use hypothesis mode;
- the explore range crossed into the holdout;
- the holdout has too few observations;
- this primary report already has a holdout;
- the same code has already observed the holdout data.

Do not copy the same formula, rename it, or nudge the threshold to manufacture a “new” unseen sample. Disclose prior observation in
another tool even if the platform cannot detect it. You can still complete the report-reading exercise, but the conclusion must say
that no first formal holdout was available.

After revealing, first record the preregistered verdict, then read the supporting evidence:

| Formal holdout evidence                          |          Result |
| ------------------------------------------------ | --------------: |
| First reveal time                                |             […] |
| Mean Rank IC and whether it exceeds `0.02`       |             […] |
| Newey–West 95% interval                          |             […] |
| ICIR / positive-IC share                         |       […] / […] |
| Equal- and market-cap-weighted D1→D10 order      |             […] |
| Net long-short / D10 turnover / maximum drawdown | […] / […] / […] |
| Coverage and valid months                        |             […] |

Once revealed, do not lower the threshold, reverse direction, or select another primary report on the same data and call it formal
out of sample.

## Step 7: Adjudicate the evidence without publishing or converting to a strategy

Finish with one of three verdicts:

- **Advance to another study**: the formal holdout meets the ex ante primary criterion, and direction, deciles, coverage, robust
  intervals, weighting, and costs contain no conflict strong enough to overturn the claim. This means only that further study is warranted.
- **Insufficient evidence**: the primary criterion passes but supporting evidence conflicts materially, or the account has no valid
  first holdout. Preserve the reason instead of selecting a successful metric as a substitute conclusion.
- **Reject the current hypothesis**: the formal holdout misses the primary criterion, reverses direction, or protocol/data problems
  prevent the report from answering the original question.

Use this structure for the final record:

```text
This exercise precommitted ep, point-in-time CSI 300 constituents from 2016-02-01, monthly frequency, global ranking,
no neutralization, and Mean Rank IC > 0.02. It allowed one predeclared size-plus-industry diagnostic.

The primary explore report's Rank IC / Newey–West 95% interval was […] / […]. Deciles, equal versus
market-cap weighting, coverage, net long-short, and turnover showed […]. The neutralized diagnostic […]
relative to the primary report.

The formal holdout was first revealed on […] and [met / missed / was unavailable for] the preregistered
criterion. Supporting evidence showed […].

The current evidence therefore [supports another study / is insufficient / rejects the hypothesis].
It describes historical CSI 300 stock cross-sections only. D10−D1 is a research diagnostic that does not
fully test borrowing, capacity, or real execution. No Factor was published, no stock list or strategy was
created, and no signal was deployed.
```

Even an “advance” verdict ends this path. A preset Factor, a research report, and an executable strategy are different objects. A
strategy needs explicit holdings, cash, rebalancing, fill constraints, and a complete backtest; copying the report's long-short curve
would not create a strategy result.

## Completion check

- [ ] Explain that `ep` reciprocates only positive `PE_TTM`; loss-making or missing observations do not enter the top group.
- [ ] Before viewing results, freeze CSI 300, monthly frequency, explore range, global ranking, no neutralization, and `Rank IC > 0.02`.
- [ ] Verify point-in-time membership, data cutoff, coverage, code hash, outlier handling, and costs.
- [ ] Distinguish Rank IC, D1 through D10, the D10−D1 research construction, and actual strategy returns.
- [ ] Read the mean, Newey–West interval, ICIR, direction share, weighting, turnover, and net result together.
- [ ] Run only one primary report and one predeclared size-plus-industry diagnostic; do not expand the search afterward.
- [ ] Reveal the formal holdout only once; if unavailable, preserve the real reason instead of bypassing the seal.
- [ ] End with advance, insufficient evidence, or rejection, without automatic publication, strategy conversion, or deployment.

When every item is complete, you have a stock-cross-section research record with preregistration and a clear holdout boundary—not a
stock recommendation.

## Next steps

- [CSI 300 trend strategy: parameters, costs, and out-of-sample evidence](/help/learning/csi300-trend-strategy)
- [Set the Factor research scope](/help/factors/evaluation-scope)
- [Read robust cross-sectional inference](/help/factors/robust-inference)
- [Market-cap and industry neutralization](/help/factors/neutralization)
- [Formal holdout and out-of-sample results](/help/factors/holdout-results)
- [Turnover, trading costs, and net returns](/help/factors/turnover-costs)
