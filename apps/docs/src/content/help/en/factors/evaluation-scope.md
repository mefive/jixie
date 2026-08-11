# Set the Factor evaluation scope

A stock cross-sectional Factor has a formal universe, a ranking scope, and diagnostic slices. They answer different questions. A strong diagnostic slice is not automatically the conclusion of the full report.

## Open scope settings

1. Select a Stock cross-sectional factor in Factor research.
2. Click More settings.
3. Find Evaluation universe, Ranking scope, and Diagnostic slices.
4. Run a new analysis after changing them.

The numbered areas are:

1. Evaluation universe.
2. Ranking scope.
3. Diagnostic slices.

![Evaluation universe, ranking scope, and diagnostics](/docs/images/help/zh/factors/evaluation-scope-01.png)

## Evaluation universe

The page supports all A-shares, CSI 300, CSI 500, and CSI 1000.

An index universe uses membership as it existed on each historical date. It does not apply today's constituents to the entire past. This avoids admitting stocks before they actually joined the index.

Changing the universe changes the research hypothesis, period samples, and attempt count. If a Factor is intended for a CSI 300 strategy, run a dedicated CSI 300 report instead of selecting CSI 300 rows from an all-market report.

## Ranking scope

- **Global ranking** compares all valid stocks in the period.
- **Within Shenwan Level-1 industry** compares stocks inside their historical industries before combining the results.

Within-industry ranking checks whether a Factor is merely favoring certain industries. It is not another name for size-and-industry neutralization. Ranking scope determines peers; neutralization controls common exposures.

## Diagnostic slices

Industry, size, and liquidity slices decompose the main result. They show sample size, coverage, Rank IC, and related evidence for each segment.

![Formal scope and diagnostic slices in a Factor report](/docs/images/help/zh/factors/evaluation-scope-02.png)

Slices do not change the main metrics or grant separate publication eligibility. If evidence only exists in one industry, pre-register that narrower scope and run it as a new study.

## Compare reports carefully

Verify that the universe, point-in-time membership, ranking scope, neutralization, outlier handling, and costs match. Also check that slice differences have enough observations and are not driven by a few months.

## Related articles

- [Set analysis scope and sample handling](/docs/help/factors/analysis-settings)
- [Rank IC, ICIR, and IC decay](/docs/help/factors/rank-ic-icir)
- [Research card, exploration, and holdout](/docs/help/factors/research-card)
