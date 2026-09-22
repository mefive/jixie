import type {
  FactorLanguage,
  MacroRegimeFactorResearchSpecV1,
  PanelFactorResearchSpecV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactorAnalysisSource } from '../sources/snapshot.js';
import type { MacroRegimeEvaluationData } from '../observations/macro-regime-observations.js';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  etf: vi.fn(),
  carry: vi.fn(),
  receipts: vi.fn(),
  usesCarry: vi.fn(),
  usesReceipts: vi.fn(),
  panel: vi.fn(),
  panelCarry: vi.fn(),
  panelUsesCarry: vi.fn(),
  macro: vi.fn(),
  crossSectional: vi.fn(),
}));

vi.mock('../runtime/factor-runtime.js', () => ({ FactorRuntime: { start: mocks.start } }));
vi.mock('../observations/etf-trend-observations.js', () => ({
  loadEtfTimeSeriesObservations: mocks.etf,
}));
vi.mock('../observations/commodity-carry-time-series-observations.js', () => ({
  loadCommodityCarryTimeSeriesObservations: mocks.carry,
  timeSeriesFactorUsesCommodityCarry: mocks.usesCarry,
}));
vi.mock('../observations/commodity-warehouse-receipt-time-series-observations.js', () => ({
  loadCommodityWarehouseReceiptTimeSeriesObservations: mocks.receipts,
  timeSeriesFactorUsesCommodityWarehouseReceipts: mocks.usesReceipts,
}));
vi.mock('../observations/panel-observations.js', () => ({
  loadPanelEtfObservations: mocks.panel,
}));
vi.mock('../observations/commodity-carry-panel-observations.js', () => ({
  loadCommodityCarryPanelObservations: mocks.panelCarry,
  panelFactorUsesCommodityCarry: mocks.panelUsesCarry,
}));
vi.mock('../observations/macro-regime-observations.js', () => ({
  loadMacroRegimeObservations: mocks.macro,
}));
vi.mock('./cross-sectional/evaluator.js', () => ({
  factorEvaluatorFor: () => ({ evaluate: mocks.crossSectional }),
}));
// The computation entry has no report/job database dependency of its own.
vi.mock('#infra/database/prisma.js', () => {
  throw new Error('The isolated computation entry must not load report persistence.');
});

import { runFactorEvaluation } from './run.js';
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
const macroSpec: MacroRegimeFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'macro_regime',
  start: '20240101',
  end: '20241231',
  observationFrequency: 'monthly',
  targetAssets: ['CN'],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20241231' },
  stateModel: { kind: 'threshold', states: 4 },
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
  mocks.carry.mockResolvedValue(rows);
  mocks.receipts.mockResolvedValue(rows);
  mocks.panel.mockResolvedValue(panelRows);
  mocks.panelCarry.mockResolvedValue(panelRows);
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

  it.each([
    { carry: true, receipts: true, loader: 'carry' as const },
    { carry: false, receipts: true, loader: 'receipts' as const },
  ])('retains time-series loader precedence: $loader', async ({ carry, receipts, loader }) => {
    const runtime = { close: vi.fn() };
    mocks.start.mockResolvedValue(runtime);
    mocks.usesCarry.mockReturnValue(carry);
    mocks.usesReceipts.mockReturnValue(receipts);
    await runFactorEvaluation({ ...options, source, spec: timeSeriesSpec });

    expect(mocks[loader]).toHaveBeenCalledWith(timeSeriesSpec, runtime);
    expect(mocks.etf).not.toHaveBeenCalled();
    expect(mocks[loader === 'carry' ? 'receipts' : 'carry']).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

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
      mocks.panelUsesCarry.mockReturnValue(language === 'python');
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
      expect(language === 'python' ? mocks.panelCarry : mocks.panel).toHaveBeenCalledWith(
        panelSpec,
        runtime,
      );
      expect(language === 'python' ? mocks.panel : mocks.panelCarry).not.toHaveBeenCalled();
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

  const composite: FactorAnalysisSource = {
    kind: 'panel_composite',
    label: 'Composite',
    definition: {
      version: 2,
      key: 'composite',
      analysisKind: 'panel',
      name: 'Composite',
      standardization: 'rank',
      weighting: 'equal',
      components: [
        { factor: 'first', direction: 'positive' },
        { factor: 'second', direction: 'positive' },
      ],
    },
    components: [
      {
        factor: 'first',
        direction: 'positive',
        label: 'First',
        code: 'first code',
        language: 'typescript',
      },
      {
        factor: 'second',
        direction: 'positive',
        label: 'Second',
        code: 'second code',
        language: 'python',
      },
    ],
  };

  it('combines mixed-language panel components and closes every runtime', async () => {
    const first = { close: vi.fn() },
      second = { close: vi.fn() };
    mocks.start.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = await runFactorEvaluation({ ...options, source: composite, spec: panelSpec });

    expect(mocks.start.mock.calls).toEqual([
      [
        {
          language: 'typescript',
          analysisKind: 'panel',
          code: 'first code',
          onUserLog: logs.onUserLog,
        },
      ],
      [
        {
          language: 'python',
          analysisKind: 'panel',
          code: 'second code',
          onUserLog: logs.onUserLog,
        },
      ],
    ]);
    expect(result).toMatchObject({ periods: 3, observations: 12, rankIcMean: 1 });
    expect(mocks.panel).toHaveBeenNthCalledWith(1, panelSpec, first);
    expect(mocks.panel).toHaveBeenNthCalledWith(2, panelSpec, second);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('releases started components if a later component fails to start', async () => {
    const first = { close: vi.fn() };
    mocks.start.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('invalid component'));
    await expect(
      runFactorEvaluation({ ...options, source: composite, spec: panelSpec }),
    ).rejects.toThrow('invalid component');
    expect(first.close).toHaveBeenCalledOnce();
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it('normalizes the legacy weather protocol without requiring a report identifier', async () => {
    const spec = createDefaultFactorAnalysisSpecV3({
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'size_industry',
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

  it('passes frozen macro data to its own evaluator and returns its raw result', async () => {
    const periods: MacroRegimeEvaluationData['periods'] = Array.from({ length: 12 }, (_, index) => {
      const month = `2024${String(index + 1).padStart(2, '0')}`;
      const asOfDate = `${month}01`;
      return {
        targetDate: `${month}28`,
        score: {
          version: 1,
          asOfDate,
          featureAvailableDate: asOfDate,
          latestVintageDate: asOfDate,
          revisionPolicy: 'as_available',
          state: 'growth_strong_inflation_low',
          growth: {
            score: 1,
            levelScore: 1,
            momentumScore: 1,
            latestPeriods: [month],
            observations: 60,
            pmi: 51,
            pmiGap: 1,
            pmiThreeMonthChange: 1,
          },
          inflation: {
            score: -1,
            levelScore: -1,
            momentumScore: -1,
            latestPeriods: [month],
            observations: 60,
            cpiYoY: 1,
            ppiYoY: 1,
            cpiThreeMonthChange: -1,
            ppiThreeMonthChange: -1,
          },
          disclosure: {
            latestValueBackfillRows: 0,
            futureVintageRows: 0,
            pointInTimeEligible: true,
          },
        },
      };
    });
    const data: MacroRegimeEvaluationData = {
      periods,
      observations: periods.map(({ score, targetDate }) => ({
        assetId: 'CN',
        asOfDate: score.asOfDate,
        featureAvailableDate: score.featureAvailableDate,
        latestVintageDate: score.latestVintageDate,
        targetDate,
        state: score.state,
        growthScore: score.growth.score,
        inflationScore: score.inflation.score,
        forwardReturn: 0.01,
      })),
      skippedMacroDates: ['20231201'],
      skippedTargetDates: [],
    };
    mocks.macro.mockResolvedValue(data);
    const result = await runFactorEvaluation({
      ...options,
      source: { kind: 'macro_regime', code: 'frozen macro', label: 'Macro' },
      spec: macroSpec,
    });
    expect(mocks.macro).toHaveBeenCalledWith(macroSpec);
    expect(result).toMatchObject({
      periods: 12,
      observations: 12,
      skippedPeriods: 1,
      pointInTimeEligible: true,
    });
    expect(mocks.start).not.toHaveBeenCalled();
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
