# CSI 300 trend strategy: parameters, costs, and out-of-sample evidence

> Learning path · About 90–120 minutes · You should be able to run one backtest. This exercise uses TypeScript because parameter
> scans currently support TypeScript strategies only.

This exercise tests one limited, executable question: **When the adjusted close of CSI 300 ETF (`510300.SH`) is above a trailing
simple moving average, hold the ETF; otherwise hold cash. Does that rule retain credible evidence under frozen costs and a fixed
sample split?**

The goal is not to discover the moving average with the highest historical return. It is to express an intuition as an unambiguous
rule, then actively look for weaknesses with a tradable baseline, nearby parameters, costs, fills, and out-of-sample results.

## What you will learn

You should be able to:

1. separate the non-tradable CSI 300 index from its tradable proxy, `510300.SH`;
2. specify signal timing, fill timing, position state, and cash without ambiguity;
3. freeze a primary parameter, sensitivity values, a sample split, and falsification conditions before viewing results;
4. audit a strategy with buy-and-hold, in-sample and out-of-sample results, fills, and stressed costs;
5. accept rejection or insufficient evidence instead of sending one backtest directly to deployment.

## Prerequisites

- If Backtest Lab is new to you, first [run your first backtest](/help/getting-started/first-backtest).
- Read [Strategies and backtests](/help/basics/strategy-backtest) and [Why a backtest is not a forecast](/help/basics/backtest-limitations).
- If ETFs and indices are unfamiliar, read [Stocks, ETFs, and indices](/help/basics/stocks-etfs-indices).
- Parameter scans do not currently support Python strategies, so select TypeScript for this exercise.

## Step 1: Freeze the experiment card before viewing results

Save the following in the strategy conversation or your own research record. Do not change the dates or passing criteria after a run:

```text
Question: From 2015-01-01 through 2025-12-31, can a long moving-average trend rule on 510300.SH
          improve drawdown or retain acceptable net returns relative to buy-and-hold in the same ETF?

Rule: Hold a 95% target weight when today's adjusted close is above its N-day simple moving average.
      Exit to cash when price is at or below the average. Today's close creates the signal;
      the order fills at the next session's open.

Precommitted primary parameter: N = 120. Sensitivity values: 20 and 60. They inspect the
                                neighborhood and are not a menu for selecting a winner afterward.
Sample: 2015-01-01 through 2025-12-31. In-sample ends on 2020-12-31; later observations are out of sample.
Baseline: 95% buy-and-hold in the same 510300.SH with identical capital, dates, and costs.

Primary evidence: in-sample and out-of-sample net return, maximum drawdown, Sharpe, turnover,
                  trade count, fees, and slippage.
Cost stress: run the primary parameter once under base costs and once under higher slippage.

Falsification: do not call the rule robust if any advantage exists at only one parameter, reverses out of sample,
               fails to improve drawdown, or disappears under a reasonable cost increase.
Limits: one ETF, one market, and historical daily data. No forecast, automatic signal, or deployment.
```

Precommitting 120 days separates a sensitivity check from a search for the best parameter. Once you see the 20-, 60-, and 120-day
results, calling the winner an ex ante choice would be false—the sample has already influenced selection.

## Step 2: Freeze instrument and execution semantics

| Item | Frozen convention | Common mistake |
| --- | --- | --- |
| Traded object | `510300.SH` CSI 300 ETF | Treating `000300.SH` index points as an executable price |
| Signal price | The platform's adjusted daily close | Computing a long average on an unadjusted series across distributions or unit changes |
| Signal time | Decision after today's close | Using today's close for both the signal and an assumed same-close fill |
| Fill time | Next session open, subject to suspension, price limits, board lots, and cash | Ignoring rejected orders or rounded quantities |
| Risk state | 95% ETF or cash, never short | Describing cash as a bearish short position |
| Baseline | Tradable buy-and-hold in the same ETF | Comparing only with a non-tradable price index |
| Costs | ETF commission, slippage, and impact; no stock stamp duty or transfer fee | Setting slippage to zero and calling the result implementable |

The CSI 300 benchmark shown in Backtest Lab is still useful, but it has index semantics. The primary baseline should use the same ETF,
which includes fund expenses, tracking differences, board-lot execution, and trading costs. Cash follows the Lab's cash convention; do
not reinterpret it as a money-market-fund return.

## Step 3: Build a tradable buy-and-hold baseline first

Create a TypeScript strategy and enter the code below. Keep it as a separate strategy instead of overwriting it with trend code, so
both results remain independently reviewable.

```typescript
const code = '510300.SH';

export default defineStrategy({
  name: 'CSI 300 ETF · 95% buy-and-hold baseline',
  watch: [code],
  onBar(ctx) {
    const price = ctx.price(code);
    if (price != null && ctx.shares(code) === 0) {
      ctx.orderTargetPercent(code, 0.95);
    }
  },
});
```

Freeze these run settings:

- Start `2015-01-01`, end `2025-12-31`.
- Capital `100`, meaning CNY 1 million.
- Keep reasonable nonzero base slippage and market impact, and record their exact values.
- Do not move the dates because the result is unattractive.

After the run, verify that the first fill occurs on the next session after data becomes available. Record total and annualized return,
maximum drawdown, Sharpe, trades, fees, and slippage. The baseline is not “no strategy.” It is the simple alternative that trend must
justify making more complex.

## Step 4: Write a scan-ready trend rule

Create another TypeScript strategy on the same ETF. `lookback` is the only scannable parameter. Keep the 95% weight fixed so signal
and sizing do not change at the same time.

```typescript
const code = '510300.SH';

export default defineStrategy({
  name: 'CSI 300 ETF · close versus moving average',
  params: { lookback: 120 },
  watch: [code],
  onBar(ctx) {
    const price = ctx.price(code);
    const average = ctx.sma(code, ctx.params.lookback);
    if (price == null || average == null) return;

    const invested = ctx.shares(code) > 0;
    if (price > average && !invested) {
      ctx.orderTargetPercent(code, 0.95);
    } else if (price <= average && invested) {
      ctx.exit(code);
    }
  },
});
```

The code submits orders only when position state changes; it does not create daily micro-rebalances merely to maintain exactly 95%.
`ctx.sma` reads adjusted history available through the current day. The signal forms after the current close and the engine attempts
the fill on the next session. When history is insufficient, `average` is `null` and the strategy does nothing.

Run the default 120-day version once with the same dates, capital, and base costs as the baseline. At this stage, verify code and fills;
do not use the full-sample result to choose a different lookback.

## Step 5: Audit the ordinary backtest instead of reading return alone

Review the baseline and 120-day trend results in this order:

1. Confirm identical dates, capital, costs, and ETF code.
2. Confirm that trend has both entries and exits and a plausible trade count.
3. Verify that the first entry occurs at the next open after the average is available and the signal appears.
4. Check whether higher return comes with deeper drawdown, turnover, or cost.
5. Ask whether a difference from the Lab's index benchmark reflects ETF-versus-index semantics rather than the rule alone.
6. Check whether outperformance is concentrated in a few regimes and whether long cash periods create opportunity cost.

Use a fixed table rather than copying only attractive metrics:

| Version | Period | Annual return | Max drawdown | Sharpe | Annual turnover | Trades | Fees | Slippage |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Buy-and-hold | 2015–2025 | […] | […] | […] | […] | […] | […] | […] |
| 120-day trend | 2015–2025 | […] | […] | […] | […] | […] | […] | […] |

An ordinary backtest result can be overwritten by the next run. Keep two separate strategies and transcribe exact settings and metrics
into a research record when long-term auditability matters; do not describe the current `lastResult` as immutable.

## Step 6: Use a parameter scan for neighborhood and out-of-sample evidence

Open **Parameter scan** on the trend strategy:

1. Select `lookback`.
2. Enter `20, 60, 120` in that order.
3. Enable the in-sample/out-of-sample option.
4. Enter `2020-12-31` as the split date.
5. Confirm that code, dates, capital, and costs have not changed.
6. Start the scan and wait for all three cells to finish.

Return to the experiment card before reading: **120 days is primary; 20 and 60 days are sensitivity checks.** Do not rank full-sample
Sharpe and relabel the winner as “the strategy.” Ask instead:

- Are all three values broadly aligned in sample and out of sample?
- Are the primary 120-day out-of-sample net return, drawdown, and Sharpe consistent with the prior?
- Do shorter lookbacks create more whipsaw, turnover, and cost?
- Is one isolated parameter unusually strong while nearby horizons contradict it?
- Is out-of-sample improvement concentrated in only a few regimes?

The scan report freezes the code identifier, configuration, costs, data cutoff, and compact result for each value. It is a stronger
strategy-research record than an ordinary `lastResult`. If you change the rule after viewing out-of-sample data, 2021–2025 is no
longer unseen; the next iteration needs a validation period that has not influenced selection.

## Step 7: Stress costs and inspect fills

Return to an ordinary run of the primary 120-day strategy. Keep code, dates, and capital fixed, then run twice:

1. **Base costs:** use the nonzero slippage and impact recorded in the experiment card.
2. **Stressed costs:** raise base slippage to at least `10 bp`, or twice its base value, whichever is higher; keep impact unchanged.

Compare annual return, maximum drawdown, fees, slippage, and final equity. Higher costs do not change historical signals, but they do
change fills and net results. A conclusion that reverses after a modest cost increase has a thin edge.

Open trade details and inspect at least the following:

- Entries follow a price-above-average signal while flat; exits follow a price-at-or-below-average signal while invested.
- Signal and fill dates differ by one trading session rather than using the same close.
- No daily fragments exist solely to rebalance back to exactly 95%.
- ETF trades have no stock stamp duty or transfer fee, while commission and slippage remain nonnegative.
- Sideways periods reveal whether repeated crossings concentrate whipsaw costs.

If fills do not match the intended rule, reject the run and repair the code first. Attractive metrics cannot compensate for incorrect
execution semantics.

## Write the conclusion

Use this structure in the final record and replace brackets with actual results:

```text
This exercise precommitted 120 days as the primary parameter; 20 and 60 days were sensitivity checks only.
In-sample ended on 2020-12-31, and 2021-01 through 2025-12 was the first out-of-sample reveal.

Relative to buy-and-hold in the same 510300.SH, the 120-day trend had full-sample annual return / maximum
drawdown of […] / […], versus […] / […] for the baseline. Its out-of-sample net return, maximum drawdown,
Sharpe, and trade count were […]. Results across 20 / 60 / 120 days were [aligned / sensitive / contradictory].

Fees and slippage under base costs were […]; stressed costs changed the net result by […]. Trade inspection
[did / did not] match next-open execution.

The evidence therefore [supports another research round / is insufficient / rejects the rule]. Even if supported,
this remains one historical daily-data rule on one ETF. Other markets, periods, selection attempts, cash return,
capacity, and live execution remain untested, so the strategy is not deployed.
```

Lower return than buy-and-hold with a shallower drawdown is not automatically failure; it exposes a return-risk trade-off. Conversely,
a small return advantage with worse drawdown, turnover, and costs is not success merely because one Sharpe value is higher.

## Completion check

- [ ] The instrument, rule, primary parameter, sensitivity values, sample split, and falsification conditions were written before runs.
- [ ] Buy-and-hold and trend use separate drafts with identical dates, capital, ETF, and base costs.
- [ ] The signal uses only adjusted history available at the time and fills at the next session open.
- [ ] The scan keeps 120 days primary and uses 20 and 60 days only as sensitivity checks.
- [ ] In-sample and first out-of-sample results are both retained; revealed data is not reused as “unseen.”
- [ ] Trades, turnover, fees, and slippage were inspected, with one higher-cost stress run.
- [ ] The conclusion says support, insufficient evidence, or reject and does not auto-deploy.
- [ ] The scan report is retained, together with the limitation that ordinary backtests can be overwritten.

Completing every item produces a strategy study that has survived an initial audit—not the discovery of a profitable strategy.

## Next steps

- [Trustworthy cross-market research: returns, FX, and correlation](/help/learning/trusted-cross-market-research)
- [Compare several strategy parameters](/help/backtesting/parameter-scan)
- [Inspect trades and costs](/help/backtesting/trades-costs)
- [Inspect backtest results](/help/backtesting/results-overview)
- [Why a backtest is not a forecast](/help/basics/backtest-limitations)
