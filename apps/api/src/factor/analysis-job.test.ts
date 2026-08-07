import type {
  FactorAnalysisSpecV3,
  FactorResearchIntentV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  reportFindFirst: vi.fn(),
  reportCreate: vi.fn(),
  reportUpdate: vi.fn(),
  rootReportFindFirst: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    factorReport: { findFirst: mocks.rootReportFindFirst },
  },
}));

import { readFactorAnalysisResult, startFactorAnalysis } from './analysis-job.js';
import { factorVariantKey, sha256 } from './report-spec.js';

const spec: FactorAnalysisSpecV3 = {
  version: 3,
  freq: 'month',
  start: '20200101',
  end: '20250101',
  neutral: 'size',
  universe: {
    minimumListingDays: 365,
    liquidityDropFraction: 0.25,
    minimumCandidates: 100,
    excludeRiskWarnings: true,
    excludePendingDelisting: true,
  },
  missing: { minimumWindowCoverage: 2 / 3 },
  outliers: {
    factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
    forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
  },
  costs: {
    commissionPerSide: 0.00025,
    stampDutySellSide: 0.0005,
    slippagePerSide: 0.001,
  },
};

const researchIntent: FactorResearchIntentV1 = {
  version: 1,
  mode: 'hypothesis',
  hypothesis: 'Quality should predict returns.',
  expectedDirection: 'positive',
  primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0.02 },
};

describe('startFactorAnalysis', () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
    mocks.reportFindFirst.mockReset();
    mocks.reportCreate.mockReset();
    mocks.reportUpdate.mockReset();
    mocks.rootReportFindFirst.mockReset();
    mocks.transaction.mockImplementation(async (run) =>
      run({
        factorReport: {
          findFirst: mocks.reportFindFirst,
          create: mocks.reportCreate,
          update: mocks.reportUpdate,
        },
      }),
    );
  });

  it('creates one immutable explore report and launches its worker', async () => {
    mocks.reportFindFirst.mockResolvedValue(null);
    const launchWorker = vi.fn(async (_options: unknown) => {});

    const response = await startFactorAnalysis({
      userId: 'user-1',
      factor: 'factor-1',
      source: { kind: 'single', code: 'factor candidate', label: 'Quality' },
      spec,
      researchIntent,
      locale: 'en',
      failedMessage: 'failed',
      exitedMessage: (code) => `exit ${code}`,
      launchWorker,
    });

    expect(response).toMatchObject({ status: 'running', reusedRunning: false });
    expect(mocks.reportFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: 'user-1',
      factor: 'factor-1',
      status: 'running',
      testKey: expect.any(String),
    });
    expect(mocks.reportCreate).toHaveBeenCalledOnce();
    expect(mocks.reportCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'user-1',
      factor: 'factor-1',
      status: 'running',
      phase: 'explore',
      factorCodeSnapshot: 'factor candidate',
      analysisKind: 'cross_sectional',
      specJson: JSON.stringify({ version: 1, analysisKind: 'cross_sectional', protocol: spec }),
      researchIntentJson: JSON.stringify(researchIntent),
      job: { create: { userId: 'user-1', kind: 'factor', status: 'running' } },
    });
    expect(mocks.reportCreate.mock.calls[0][0].data.variantKey).toBe(
      factorVariantKey(spec, sha256('factor candidate'), null),
    );
    expect(launchWorker).toHaveBeenCalledOnce();
    expect(launchWorker.mock.calls[0][0]).toMatchObject({
      reportId: response.reportId,
      jobId: response.jobId,
      source: { kind: 'single', code: 'factor candidate', label: 'Quality' },
      spec: { version: 1, analysisKind: 'cross_sectional', protocol: spec },
    });
  });

  it('persists a frozen ETF time-series protocol and source', async () => {
    mocks.reportFindFirst.mockResolvedValue(null);
    const launchWorker = vi.fn(async (_options: unknown) => {});
    const timeSeriesSpec: TimeSeriesFactorResearchSpecV1 = {
      version: 1,
      analysisKind: 'time_series',
      start: '20200101',
      end: '20241231',
      observationFrequency: 'daily',
      assets: ['511010.SH'],
      target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
      dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20250131' },
      inference: { standardError: 'newey_west', lag: 'automatic' },
    };
    const source = {
      kind: 'time_series' as const,
      label: 'ETF 20-day trend',
      code: 'executable Factor V2 source',
    };

    await startFactorAnalysis({
      userId: 'user-1',
      factor: 'etf_trend_20',
      source,
      spec: timeSeriesSpec,
      researchIntent: {
        version: 1,
        mode: 'exploratory',
        expectedDirection: 'positive',
      },
      locale: 'en',
      failedMessage: 'failed',
      exitedMessage: (code) => `exit ${code}`,
      launchWorker,
    });

    expect(mocks.reportCreate.mock.calls[0][0].data).toMatchObject({
      factor: 'etf_trend_20',
      analysisKind: 'time_series',
      freq: 'day',
      neutral: 'none',
      start: '20200101',
      end: '20241231',
      factorCodeSnapshot: source.code,
    });
    expect(JSON.parse(mocks.reportCreate.mock.calls[0][0].data.specJson)).toEqual(timeSeriesSpec);
    expect(launchWorker.mock.calls[0][0]).toMatchObject({ source, spec: timeSeriesSpec });
  });

  it('reuses the same running frozen variant instead of launching twice', async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: 'report-existing',
      job: { id: 'job-existing', status: 'running' },
    });
    const launchWorker = vi.fn(async (_options: unknown) => {});

    const response = await startFactorAnalysis({
      userId: 'user-1',
      factor: 'factor-1',
      source: { kind: 'single', code: 'factor candidate', label: 'Quality' },
      spec,
      researchIntent,
      locale: 'en',
      failedMessage: 'failed',
      exitedMessage: (code) => `exit ${code}`,
      launchWorker,
    });

    expect(response).toEqual({
      reportId: 'report-existing',
      jobId: 'job-existing',
      reusedRunning: true,
      status: 'running',
    });
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(launchWorker).not.toHaveBeenCalled();
  });

  it('freezes the full source bundle for a composite report', async () => {
    mocks.reportFindFirst.mockResolvedValue(null);
    const launchWorker = vi.fn(async (_options: unknown) => {});
    const definition = {
      version: 1 as const,
      name: 'Quality + value',
      standardization: 'rank' as const,
      weighting: 'equal' as const,
      components: [
        { factor: 'roe_ttm', direction: 'positive' as const },
        { factor: 'ep_ttm', direction: 'positive' as const },
      ],
    };
    const source = {
      kind: 'composite' as const,
      label: definition.name,
      definition,
      components: [
        { factor: 'roe_ttm', label: 'ROE', code: 'roe code', direction: 'positive' as const },
        { factor: 'ep_ttm', label: 'EP', code: 'ep code', direction: 'positive' as const },
      ],
    };
    const compositeSpec = { ...spec, version: 4 as const, composite: definition };

    await startFactorAnalysis({
      userId: 'user-1',
      factor: 'composite-1',
      source,
      spec: compositeSpec,
      researchIntent,
      locale: 'en',
      failedMessage: 'failed',
      exitedMessage: (code) => `exit ${code}`,
      launchWorker,
    });

    const snapshot = mocks.reportCreate.mock.calls[0][0].data.factorCodeSnapshot;
    expect(JSON.parse(snapshot)).toEqual(source);
    expect(launchWorker.mock.calls[0][0]).toMatchObject({
      source,
      spec: { version: 1, analysisKind: 'cross_sectional', protocol: compositeSpec },
    });
  });
});

describe('readFactorAnalysisResult', () => {
  it('owner-scopes and parses a completed explore payload', async () => {
    mocks.rootReportFindFirst.mockResolvedValue({
      status: 'done',
      error: null,
      payload: JSON.stringify({ factor: 'factor-1', icMean: 0.03 }),
    });

    const result = await readFactorAnalysisResult('user-1', 'report-1');

    expect(mocks.rootReportFindFirst).toHaveBeenCalledWith({
      where: { id: 'report-1', userId: 'user-1', phase: 'explore' },
      select: { status: true, error: true, payload: true },
    });
    expect(result).toMatchObject({ status: 'done', payload: { icMean: 0.03 } });
  });
});
