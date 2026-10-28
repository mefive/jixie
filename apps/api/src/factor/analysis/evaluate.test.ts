import type {
  FactorLanguage,
  PanelFactorResearchSpecV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  etf: vi.fn(),
  panel: vi.fn(),
  macro: vi.fn(),
  crossSectional: vi.fn(),
}));

vi.mock('../sandbox/factor-sandbox.js', () => ({ FactorSandbox: { start: mocks.start } }));
vi.mock('../observations/etf-trend-observations.js', () => ({
  loadEtfTimeSeriesObservations: mocks.etf,
}));
vi.mock('../observations/panel-observations.js', () => ({
  loadPanelEtfObservations: mocks.panel,
}));
vi.mock('./cross-sectional/cross-sectional-evaluator.js', () => ({
  factorEvaluatorFor: () => ({ evaluate: mocks.crossSectional }),
}));
// The computation entry has no report/job database dependency of its own.
vi.mock('#infra/database/prisma.js', () => {
  throw new Error('The isolated computation entry must not load report persistence.');
});

import { runFactorEvaluation } from './evaluate.js';
import { createDefaultFactorAnalysisSpecV3 } from './spec.js';

const timeSeriesSpec: TimeSeriesFactorResearchSpecV1 = {
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
const panelSpec: PanelFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'panel',
  start: '20240101',
  end: '20241231',
  observationFrequency: 'monthly',
  assets: [
    { assetId: 'CN', assetClass: 'cn_equity' },
    { assetId: 'US', assetClass: 'overseas_equity' },
    { assetId: 'BOND', assetClass: 'fixed_income' },
    { assetId: 'GOLD', assetClass: 'gold' },
  ],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20241231' },
  rankingScope: 'cross_asset',
  volatilityScaling: 'none',
  minimumAssetsPerPeriod: 4,
  portfolio: { topFraction: 0.25, bottomFraction: 0.25, transactionCostPerSide: 0.001 },
};
const logs = { onSystemLog: vi.fn(), onUserLog: vi.fn() };
const options = { factor: 'frozen-factor', locale: 'en' as const, ...logs };
const source = { kind: 'time_series', code: 'frozen code', label: 'Frozen factor' } as const;
const rows = [-2, -1, 1, 2].map((score, index) => ({
  assetId: '511010.SH',
  asOfDate: `2024010${index + 1}`,
  featureAvailableDate: `2024010${index + 1}`,
  targetDate: `2024020${index + 1}`,
  score,
  forwardReturn: score * 0.02,
}));
const panelRows = [
  ['20240131', '20240229'],
  ['20240229', '20240329'],
  ['20240329', '20240430'],
].flatMap(([asOfDate, targetDate]) =>
  panelSpec.assets.map((asset, index) => ({
    ...asset,
    asOfDate,
    featureAvailableDate: asOfDate,
    targetDate,
    score: 4 - index,
    forwardReturn: [0.04, 0.02, 0.01, -0.01][index],
    volatility: 0.1,
  })),
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.etf.mockResolvedValue(rows);
  mocks.panel.mockResolvedValue(panelRows);
});

describe('shared factor evaluation', () => {
  it.each<FactorLanguage>(['typescript', 'python'])(
    'returns a raw time-series report for %s and delivers before closing',
    async (language) => {
      const events: string[] = [];
      const runtime = { close: vi.fn(() => events.push('close')) };
      mocks.start.mockResolvedValue(runtime);
      const onResult = vi.fn(() => events.push('result'));
      const result = await runFactorEvaluation({
        ...options,
        source: { ...source, language },
        spec: timeSeriesSpec,
        onResult,
      });

      expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
        language,
        analysisKind: 'time_series',
        code: source.code,
        onUserLog: logs.onUserLog,
      });
      expect(mocks.etf).toHaveBeenCalledWith(timeSeriesSpec, runtime);
      expect(result).toMatchObject({
        periods: 4,
        observations: 4,
        byAsset: [expect.objectContaining({ correlation: 1, regressionSlope: 0.02 })],
      });
      expect(onResult).toHaveBeenCalledWith(result);
      expect(events).toEqual(['result', 'close']);
      expect(runtime.close).toHaveBeenCalledOnce();
    },
  );

  it.each(['loading', 'evaluation', 'delivery', 'disposal'] as const)(
    'preserves %s failures and cleanup ordering',
    async (stage) => {
      const failure = new Error(`${stage} failed`);
      const runtime = {
        close: vi.fn(() => {
          if (stage === 'disposal') {
            throw failure;
          }
        }),
      };
      mocks.start.mockResolvedValue(runtime);
      if (stage === 'loading') {
        mocks.etf.mockRejectedValue(failure);
      }
      if (stage === 'evaluation') {
        mocks.etf.mockResolvedValue([{ ...rows[0], featureAvailableDate: '20250101' }]);
      }
      const onResult = vi.fn(() => {
        if (stage === 'delivery') {
          throw failure;
        }
      });
      await expect(
        runFactorEvaluation({ ...options, source, spec: timeSeriesSpec, onResult }),
      ).rejects.toThrow(stage === 'evaluation' ? /look-ahead bias/ : failure);
      expect(runtime.close).toHaveBeenCalledOnce();
      expect(onResult).toHaveBeenCalledTimes(stage === 'delivery' || stage === 'disposal' ? 1 : 0);
    },
  );

  it.each<FactorLanguage>(['typescript', 'python'])(
    'evaluates a %s panel and frees its runtime',
    async (language) => {
      const runtime = { close: vi.fn() };
      mocks.start.mockResolvedValue(runtime);
      const result = await runFactorEvaluation({
        ...options,
        source: { kind: 'panel', code: 'panel code', label: 'Panel', language },
        spec: panelSpec,
      });

      expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
        language,
        analysisKind: 'panel',
        code: 'panel code',
        onUserLog: logs.onUserLog,
      });
      expect(mocks.panel).toHaveBeenCalledWith(panelSpec, runtime);
      expect(result).toMatchObject({
        periods: 3,
        observations: 12,
        rankIcMean: 1,
        periodReports: Array.from({ length: 3 }, () =>
          expect.objectContaining({ longShortGrossReturn: 0.05 }),
        ),
      });
      expect(runtime.close).toHaveBeenCalledOnce();
    },
  );

  it('normalizes a legacy single-factor protocol without requiring a report identifier', async () => {
    const spec = createDefaultFactorAnalysisSpecV3({
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'size',
    });
    const frozenSource = { kind: 'single', code: 'weather code', label: 'Pinned' } as const;
    const report = { factor: 'frozen-factor', periods: 2, periodObservations: [] };
    mocks.crossSectional.mockResolvedValue(report);
    const result = await runFactorEvaluation({ ...options, source: frozenSource, spec });

    expect(result).toBe(report);
    expect(mocks.crossSectional).toHaveBeenCalledWith({
      ...options,
      source: frozenSource,
      researchSpec: { version: 1, analysisKind: 'cross_sectional', protocol: spec },
    });
  });

  it('rejects a source/protocol mismatch before starting a runtime', async () => {
    await expect(
      runFactorEvaluation({
        ...options,
        source: { ...source, kind: 'single' },
        spec: timeSeriesSpec,
      }),
    ).rejects.toThrow('Time-series evaluator requires a Factor V2 source.');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.etf).not.toHaveBeenCalled();
  });
});
