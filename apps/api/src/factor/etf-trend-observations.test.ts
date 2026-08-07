import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { buildEtfTimeSeriesObservations, type EtfTrendDailyRow } from './etf-trend-observations.js';

const spec: TimeSeriesFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'time_series',
  start: '20240103',
  end: '20240106',
  observationFrequency: 'daily',
  assets: ['511010.SH'],
  target: { kind: 'forward_total_return', horizon: 2, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20240108' },
  inference: { standardError: 'newey_west', lag: 'automatic' },
};

const rows: EtfTrendDailyRow[] = [
  [1, 100, 1],
  [2, 101, 1],
  [3, 102, 1],
  [4, 51.5, 2],
  [5, 52, 2],
  [6, 52.5, 2],
  [7, 53, 2],
  [8, 53.5, 2],
].map(([day, close, adjustmentFactor]) => ({
  assetId: '511010.SH',
  tradeDate: `2024010${day}`,
  close,
  adjustmentFactor,
}));

const factorCode = `export default defineFactorV2({
  version: 2,
  name: 'ETF 2-day trend',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['fixed_income'],
  window: 3,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', 2);
    return current != null && previous != null ? current / previous - 1 : null;
  },
});`;

async function build(sourceRows: EtfTrendDailyRow[]) {
  const factor = await compileTimeSeriesFactor(factorCode);
  try {
    return await buildEtfTimeSeriesObservations(spec, sourceRows, factor);
  } finally {
    factor.dispose();
  }
}

describe('ETF trend observations', () => {
  it('uses frozen Factor V2 code and adjusted prices for scores and forward returns', async () => {
    const observations = await build(rows);

    expect(observations).toHaveLength(4);
    expect(observations[0]).toMatchObject({
      asOfDate: '20240103',
      featureAvailableDate: '20240103',
      targetDate: '20240105',
    });
    expect(observations[0].score).toBeCloseTo(0.02, 12);
    expect(observations[0].forwardReturn).toBeCloseTo(104 / 102 - 1, 12);
    expect(observations[1].score).toBeCloseTo(103 / 101 - 1, 12);
  });

  it('does not let later target prices change an earlier factor score', async () => {
    const baseline = await build(rows);
    const changed = rows.map((row) => ({ ...row }));
    changed[4].close *= 10;
    const withChangedFuture = await build(changed);

    expect(withChangedFuture[0].score).toBe(baseline[0].score);
    expect(withChangedFuture[0].forwardReturn).not.toBe(baseline[0].forwardReturn);
  });

  it('fails closed when an adjustment factor is missing', async () => {
    const incomplete = rows.map((row) => ({ ...row }));
    incomplete[3].adjustmentFactor = Number.NaN;

    await expect(build(incomplete)).rejects.toThrow(/incomplete/);
  });
});
