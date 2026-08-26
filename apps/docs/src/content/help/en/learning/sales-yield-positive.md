# Sales yield: from a positive holdout to Factor admission

> Learning path · 75–105 minutes · Run one preset Factor analysis first.

This exercise answers a question the earlier learning paths did not: **can one equity Factor retain the same direction through a
frozen definition, a redundancy gate, and its first formal holdout, and therefore deserve another research round?**

Yes. `sales_yield` is the first positive learning path. It passed `mean Rank IC > 0.01` in both exploration and the original
2025-02-05–2026-07-30 holdout, then entered the preset Factor catalog on August 12, 2026.

Here, “positive” means **the ranking evidence supports further research**. It does not mean that a deployable strategy exists.

| Evidence | Exploration | Formal holdout | Prior requirement | Verdict |
| --- | ---: | ---: | ---: | --- |
| Mean Rank IC | 0.03775 | **0.03469** | `> 0.01` | Passed |
| Annualized ICIR | 1.6504 | **1.5354** | Diagnostic | Same direction |
| Positive-IC rate | 70.00% | **64.71%** | `> 50%` | Supportive |
| Equal-weight net long–short annualized | 8.58% | **0.66%** | `> 0` | Marginal pass |
| Top-bucket turnover | 16.10% | **17.75%** | Diagnostic | Relatively low |

## What you will learn

You should be able to:

1. explain the relationship between sales yield and price-to-sales, and why it remains only a value proxy;
2. freeze direction, primary criterion, universe, costs, and a redundancy cutoff before seeing results;
3. separate a passing Rank IC, positive costed buckets, and an actually tradable strategy;
4. reconcile code hashes across the candidate, exploration, holdout, and admitted preset;
5. retain market-cap weighting, terminal-month sensitivity, and unavailable historical filters in a positive verdict.

## Step 1: define a signal that cannot be rewritten later

Trailing price-to-sales relates market value to revenue over the previous twelve months. Sales yield is its reciprocal:

$$
SalesYield_{i,t}=\frac{1}{PS\_TTM_{i,t}}\approx\frac{TTM\ Revenue_{i,t}}{MarketCap_{i,t}}
$$

A larger value means more historical revenue per unit of market value. It may capture a valuation discount, but it may also capture
low margins, cyclicality, or business-model differences. A “cheap” story cannot decide the result.

The frozen implementation has one guard: a missing or non-positive `PS_TTM` produces no exposure.

```ts
export default defineFactor({
  name: '销售收益率(1/PS_TTM)',
  compute: (bar) => (bar.psTtm && bar.psTtm > 0 ? 1 / bar.psTtm : null),
});
```

The platform reads the dated historical `DailyBasic.PS_TTM` cross-section on each formation date instead of backfilling today's
multiple. The study still relies on the vendor's historical daily TTM valuation series; it does not reconstruct every revenue-statement
vintage independently. Keep that data boundary in the conclusion.

## Step 2: freeze three admission gates

The original August 12, 2026 protocol was fixed before any holdout result appeared:

```text
Hypothesis: after size and industry neutralization, sales yield retains a positive relation with
next-month A-share return ranks.

Exploration: 2020-01-01 through 2025-01-27; monthly; all A-shares.
Universe: listed for 365 days; exclude historical risk warnings and pending delistings;
drop the least-liquid 25%; require at least 100 stocks per period.
Treatment: winsorize exposure and forward returns at 1% per tail; size+industry neutralization.
Costs: 2.5 bp commission per side, 5 bp sell-side stamp duty, and 10 bp slippage per side.

Primary criterion: mean Rank IC > 0.01.
Redundancy gate: absolute mean cross-sectional Spearman correlation with both ep and bp < 0.90.
Diagnostics: positive-IC rate > 50% and equal-weight net high-minus-low annualized return > 0.

Formal holdout: start only after exploration and redundancy pass; retain identical code,
parameters, direction, and threshold; reveal once.
```

The gates ask different questions: does the direction exist, is it merely a renamed value Factor, and is any economic magnitude left
after simple costs? The best-looking diagnostic cannot replace the primary criterion after the run.

## Step 3: read exploration without touching the holdout

The exploration report contains 60 valid months. Neutralized Rank IC was 0.03775, annualized ICIR was 1.6504, and 42 months had
positive IC. Equal-weight D10−D1 annualized return was 10.00% gross and 8.58% after frozen costs. Average one-way top-bucket
turnover was 16.10%.

![Original sales-yield exploration report](/docs/images/help/zh/learning/sales-yield-explore-result.png)

| Exploration check | Result | Interpretation |
| --- | ---: | --- |
| Rank IC | 0.03775 | Higher sales yield generally ranked with higher next-month returns |
| Positive IC | 70.00% | A small set of months did not carry the direction alone |
| Equal-weight net long–short | 8.58% | The simple diagnostic stayed positive after frozen costs |
| Market-cap-weighted net long–short | -2.62% | Economic results were sensitive to weighting |
| Valid periods | 60 / 60 | No month failed the minimum sample rule |

The primary criterion passed, but the negative market-cap-weighted spread already says this is a **cross-sectional ranking candidate**,
not an unconstrained return curve ready for implementation.
The report also marks historical negative-equity and long-suspension filters as unavailable. The system did not backfill today's
status into history, but those two historical-investability limits remain incomplete.

## Step 4: show that it is not an existing value Factor in disguise

On 61 exploration formation dates, the same stock cross-sections produced these mean Spearman correlations:

| Comparison | Correlation with sales yield | Frozen cutoff | Result |
| --- | ---: | ---: | --- |
| Earnings yield `ep` | 0.46954 | absolute value `< 0.90` | Passed |
| Book-to-market `bp` | 0.59189 | absolute value `< 0.90` | Passed |
| Size `size` | -0.01172 | Diagnostic | Near zero |

Sales yield belongs to the value family, but it did not become a synonymous reranking of EP or BP. Only after this gate passed could
the protocol create the formal holdout.

## Step 5: read the single original reveal

The original holdout completed while sealed and was first revealed at **14:08 China time on August 12, 2026**. It retained the same
code and protocol. Its SHA-256 was:

```text
abd0b11b68739b08a71e9348012aff14764fe688310575b9f93e3ce0cf81acca
```

The automated acceptance for this tutorial only reads the two original immutable reports and confirms that the later `sales_yield`
preset still has the same code hash. Reopening or capturing those reports is not a new out-of-sample test and must not be counted as a
second success.

![Original formal sales-yield holdout report](/docs/images/help/zh/learning/sales-yield-holdout-result.png)

| Holdout metric | Result | Verdict |
| --- | ---: | --- |
| Valid months | 17 | Complete frozen window |
| Rank IC | **0.03469** | Passed `> 0.01` |
| Annualized ICIR | 1.5354 | Same direction as exploration |
| Positive IC | 64.71% | 11 of 17 months |
| Equal-weight gross long–short | 2.09% | Positive |
| Equal-weight net long–short | **0.66%** | Positive but thin |
| Top-bucket turnover | 17.75% | Close to exploration |
| Market-cap-weighted net long–short | -2.78% | Conflicting evidence |

The last month contributed Rank IC 0.2550 and a 15.05% net long–short return, so it mattered greatly to the economic curve. As a
post-hoc sensitivity diagnostic, removing that month leaves mean Rank IC near 0.02092—still above the primary threshold—but turns the
costed cumulative spread negative. **The ranking evidence is more dependable than the tradable-return evidence.**

## Step 6: write a limited but genuinely positive verdict

```text
Research verdict: sales yield is supported for another Factor-research round and admission to the preset catalog.

Primary evidence: exploration Rank IC was 0.03775 and formal holdout Rank IC was 0.03469,
both above the prior 0.01 threshold. Positive-IC rates were 70.00% and 64.71%.

Redundancy: exploration correlations with ep and bp were 0.46954 and 0.59189,
both below the 0.90 rejection threshold.

Economic evidence: equal-weight net long–short annualized return fell from 8.58% in exploration
to 0.66% in holdout. It stayed positive but modest. Market-cap weighting was negative and the
holdout return depended on its last month, so no robust strategy has been established.

Action: retain sales_yield as an admitted Factor and allow it into portfolio research. Do not
generate a stock list, deploy it alone, or present D10−D1 as an executable retail strategy.
A formal upgrade requires new data and a frozen portfolio protocol.
```

That is the boundary of a positive result: it may advance, but it may not skip stages.

## What the business can do next

- use `sales_yield` as a value component in later multifactor portfolio research;
- monitor monthly Rank IC, coverage, turnover, and correlation drift versus EP and BP;
- specify universe, weighting, industry/size constraints, holdings, fills, and capacity at the portfolio layer;
- treat observations after July 30, 2026 as genuinely new evidence rather than repeatedly inspecting the revealed holdout.

Do not extrapolate a 0.66% diagnostic return into a forecast or tune the known holdout and announce a “stronger” version.

## Completion checklist

- [ ] Write the `1 / PS_TTM` definition, direction, and missing-value rule.
- [ ] State the primary criterion, redundancy gate, diagnostics, and frozen costs.
- [ ] Verify that exploration, holdout, and preset code share one SHA-256.
- [ ] Count only the August 12, 2026 original reveal as the formal holdout.
- [ ] Retain positive equal-weight, negative market-cap-weighted, and terminal-month evidence together.
- [ ] End with “admit for research and advance one stage,” not “deploy a strategy.”

## Continue reading

- [Run your first preset Factor analysis](/help/factors/first-preset-analysis)
- [The preregistration card](/help/factors/research-card)
- [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir)
- [Neutralization and exposure diagnostics](/help/factors/neutralization)
- [Formal holdouts and out-of-sample results](/help/factors/holdout-results)
- [Turnover, costs, and capacity](/help/factors/turnover-costs)
- [CSI 300 value Factor: ranking, IC, portfolios, and holdout](/help/learning/csi300-value-factor)
