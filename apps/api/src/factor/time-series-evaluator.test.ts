import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import {
  resolveNeweyWestLag,
  TimeSeriesEvaluator,
  type TimeSeriesEvaluationObservation,
} from './time-series-evaluator.js';

const spec: TimeSeriesFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'time_series',
  start: '20240101',
  end: '20241231',
  observationFrequency: 'daily',
  assets: ['511010.SH'],
  target: { kind: 'forward_total_return', horizon: 3, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20241231' },
  inference: { standardError: 'newey_west', lag: 'automatic' },
};

function observation(
  day: number,
  score: number,
  forwardReturn: number,
): TimeSeriesEvaluationObservation {
  return {
    assetId: '511010.SH',
    asOfDate: `202401${String(day).padStart(2, '0')}`,
    featureAvailableDate: `202401${String(day).padStart(2, '0')}`,
    targetDate: `202402${String(day).padStart(2, '0')}`,
    score,
    forwardReturn,
  };
}

describe('TimeSeriesEvaluator', () => {
  it('reports per-asset predictive strength and conditional returns', () => {
    const report = new TimeSeriesEvaluator().evaluate(spec, [
      observation(1, -2, -0.04),
      observation(2, -1, -0.02),
      observation(3, 1, 0.02),
      observation(4, 2, 0.04),
    ]);

    expect(report).toMatchObject({
      assets: ['511010.SH'],
      periods: 4,
      observations: 4,
    });
    expect(report.byAsset[0]).toMatchObject({
      assetId: '511010.SH',
      observations: 4,
      correlation: 1,
      regressionSlope: 0.02,
      directionHitRate: 1,
      neweyWestLag: 2,
      positiveStateMeanReturn: 0.03,
      negativeStateMeanReturn: -0.03,
    });
  });

  it('uses at least horizon minus one lags for overlapping daily targets', () => {
    expect(resolveNeweyWestLag(spec, 100)).toBeGreaterThanOrEqual(2);
    expect(
      resolveNeweyWestLag({ ...spec, inference: { standardError: 'newey_west', lag: 1 } }, 100),
    ).toBe(2);
  });

  it('rejects features that were not available at the decision time', () => {
    const rows = [observation(1, -1, -0.01), observation(2, 0, 0), observation(3, 1, 0.01)];
    rows[1].featureAvailableDate = '20240201';

    expect(() => new TimeSeriesEvaluator().evaluate(spec, rows)).toThrow(/look-ahead bias/);
  });

  it('rejects targets beyond the frozen data cutoff', () => {
    const rows = [observation(1, -1, -0.01), observation(2, 0, 0), observation(3, 1, 0.01)];
    rows[2].targetDate = '20250101';

    expect(() => new TimeSeriesEvaluator().evaluate(spec, rows)).toThrow(/data cutoff/);
  });
});
