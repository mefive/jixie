import { describe, expect, it } from 'vitest';
import {
  factorResearchCriterionPassed,
  factorResearchMetricValue,
  type FactorResearchReportPayloadV1,
} from '@jixie/shared';
import { enoughHoldoutPeriods, researchCounts } from './research.js';

describe('factor research discipline', () => {
  it('counts completed unique exploration tests separately from reports', () => {
    const rows = [
      { phase: 'explore', status: 'done', testKey: 'a', revealedAt: null },
      { phase: 'explore', status: 'done', testKey: 'a', revealedAt: null },
      { phase: 'explore', status: 'error', testKey: 'b', revealedAt: null },
      { phase: 'legacy', status: 'done', testKey: null, revealedAt: null },
      { phase: 'holdout', status: 'done', testKey: 'a', revealedAt: new Date() },
    ];

    expect(researchCounts(rows)).toEqual({
      exploreRunCount: 2,
      exploreTestCount: 1,
      legacyRunCount: 1,
      holdoutCount: 1,
      revealedHoldoutCount: 1,
      expectedFalsePositivesAtFivePercent: 0.05,
    });
  });

  it('enforces the minimum holdout span by frequency', () => {
    expect(enoughHoldoutPeriods('month', '20250101', '20250601')).toBe(false);
    expect(enoughHoldoutPeriods('month', '20250101', '20250701')).toBe(true);
    expect(enoughHoldoutPeriods('week', '20250101', '20250301')).toBe(false);
    expect(enoughHoldoutPeriods('week', '20250101', '20250401')).toBe(true);
    expect(enoughHoldoutPeriods('day', '20250101', '20250901')).toBe(false);
    expect(enoughHoldoutPeriods('day', '20250101', '20251001')).toBe(true);
  });

  it('reduces a multi-asset time-series report to predeclared scalar criteria', () => {
    const payload: FactorResearchReportPayloadV1 = {
      version: 1,
      analysisKind: 'time_series',
      report: {
        assets: ['bond', 'gold', 'equity'],
        periods: 100,
        observations: 300,
        byAsset: [
          timeSeriesAsset('bond', 2.4, 0.58),
          timeSeriesAsset('gold', 1.8, 0.54),
          timeSeriesAsset('equity', 2.1, 0.55),
        ],
      },
    };

    expect(factorResearchMetricValue(payload, 'time_series_median_newey_west_t')).toBe(2.1);
    expect(factorResearchMetricValue(payload, 'time_series_mean_direction_hit_rate')).toBeCloseTo(
      0.5567,
      3,
    );
    expect(
      factorResearchCriterionPassed(payload, {
        version: 1,
        mode: 'hypothesis',
        hypothesis: 'Trend predicts future returns across the selected ETF proxies.',
        expectedDirection: 'positive',
        primaryCriterion: {
          metric: 'time_series_median_newey_west_t',
          operator: 'gt',
          value: 1.96,
        },
      }),
    ).toBe(true);
    expect(Number.isNaN(factorResearchMetricValue(payload, 'rank_ic_mean'))).toBe(true);
  });
});

function timeSeriesAsset(assetId: string, neweyWestTStat: number, directionHitRate: number) {
  return {
    assetId,
    observations: 100,
    correlation: 0.1,
    regressionSlope: 0.01,
    directionHitRate,
    neweyWestLag: 20,
    neweyWestTStat,
    positiveStateMeanReturn: 0.01,
    negativeStateMeanReturn: -0.01,
  };
}
