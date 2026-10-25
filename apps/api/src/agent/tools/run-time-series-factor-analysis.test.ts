import type { FactorTimeSeriesReportV1, RunFactorAnalysisResponse } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: { factor: { findFirst: mocks.findFirst } },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import { runTimeSeriesFactorAnalysisTool } from './run-time-series-factor-analysis.js';

const report: FactorTimeSeriesReportV1 = {
  assets: ['511010.SH', '518880.SH'],
  periods: 100,
  observations: 200,
  byAsset: [
    {
      assetId: '511010.SH',
      observations: 100,
      correlation: 0.08,
      regressionSlope: 0.07,
      directionHitRate: 0.56,
      neweyWestLag: 19,
      neweyWestTStat: 2.2,
      positiveStateMeanReturn: 0.01,
      negativeStateMeanReturn: -0.01,
    },
    {
      assetId: '518880.SH',
      observations: 100,
      correlation: 0.05,
      regressionSlope: 0.04,
      directionHitRate: 0.52,
      neweyWestLag: 19,
      neweyWestTStat: 1.4,
      positiveStateMeanReturn: 0.02,
      negativeStateMeanReturn: 0,
    },
  ],
};

describe('runTimeSeriesFactorAnalysisTool', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue({ id: 'factor-1', name: 'ETF 趋势' });
  });

  it('freezes the ETF time-series contract and returns aggregate plus per-asset metrics', async () => {
    const started: RunFactorAnalysisResponse = {
      reportId: 'report-1',
      jobId: 'job-1',
      status: 'running',
      reusedRunning: false,
    };
    const start = vi.fn(async (_options: unknown) => started);
    const wait = vi.fn(async () => ({ status: 'done' as const, payload: report }));
    const tool = runTimeSeriesFactorAnalysisTool({
      userId: 'user-1',
      factorId: 'factor-1',
      currentCode: 'current Definition V2',
      locale: 'zh',
      start,
      wait,
    });

    const result = await tool.run({
      code: 'candidate Definition V2',
      start: '20200101',
      end: '20260730',
      assets: ['511010.SH', '518880.SH'],
      horizon: 20,
    });

    expect(start.mock.calls[0][0]).toMatchObject({
      factor: 'factor-1',
      source: {
        kind: 'time_series',
        code: 'candidate Definition V2',
        label: 'ETF 趋势',
      },
      spec: {
        analysisKind: 'time_series',
        observationFrequency: 'daily',
        assets: ['511010.SH', '518880.SH'],
        target: { horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: { pointInTime: true, dataCutoff: '20260730' },
        inference: { standardError: 'newey_west', lag: 'automatic' },
      },
    });
    expect(JSON.parse(result.observation)).toMatchObject({
      analysisKind: 'time_series',
      reportId: 'report-1',
      metrics: {
        observations: 200,
        medianNeweyWestT: 1.8,
        meanDirectionHitRate: 0.54,
        assets: [
          { assetId: '511010.SH', neweyWestTStat: 2.2 },
          { assetId: '518880.SH', neweyWestTStat: 1.4 },
        ],
      },
    });
    expect(result.rows).toBe(2);
  });
});
