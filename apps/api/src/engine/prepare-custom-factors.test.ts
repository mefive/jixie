import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  factorFindMany: vi.fn(),
  compositeFindMany: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    factor: { findMany: mocks.factorFindMany },
    factorComposite: { findMany: mocks.compositeFindMany },
    factorReport: { findMany: mocks.reportFindMany },
  },
}));

import { extractFactorKeys, prepareStrategyFactors } from './prepare-custom-factors.js';
import { canonicalJson, sha256 } from '../factor/report-spec.js';

const SOURCE = `export default defineFactor({ compute: (bar) => bar.pb });`;

function factor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'factor-1',
    key: 'book_to_market',
    name: 'Book to market',
    code: SOURCE,
    analysisKind: 'cross_sectional',
    codeHash: 'abc123',
    approvedReportId: 'report-1',
    userId: 'user-1',
    ...overrides,
  };
}

describe('published factor preparation', () => {
  beforeEach(() => {
    mocks.factorFindMany.mockReset().mockResolvedValue([factor()]);
    mocks.compositeFindMany.mockReset().mockResolvedValue([]);
    mocks.reportFindMany.mockReset().mockResolvedValue([]);
  });

  it('loads the exact owned factor and records run lineage', async () => {
    const prepared = await prepareStrategyFactors(
      `ctx.factor('book_to_market', '000001.SZ')`,
      'user-1',
      'zh',
    );

    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ key: { in: ['book_to_market'] } }),
      }),
    );
    expect(prepared.modules[0]).toMatchObject({ key: 'book_to_market' });
    expect(prepared.modules[0].js).toContain('defineFactor');
    expect(prepared.factors).toEqual([
      {
        factorId: 'factor-1',
        key: 'book_to_market',
        name: 'Book to market',
        analysisKind: 'cross_sectional',
        codeHash: 'abc123',
        approvedReportId: 'report-1',
      },
    ]);
  });

  it('finds raw keys in both the declaration and direct calls', () => {
    expect(
      extractFactorKeys(`
        export default defineStrategy({
          factors: ['book_to_market', 'mf_net_main'],
          onBar(ctx) { return ctx.factor('quality_score', '000001.SZ'); },
        });
      `),
    ).toEqual(['quality_score', 'book_to_market']);
  });

  it('compiles the published time-series contract for research backtests', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factor({
        key: 'etf_trend_20',
        analysisKind: 'time_series',
        code: `export default defineFactorV2({
          version: 2,
          name: 'ETF trend',
          analysisKind: 'time_series',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 21,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);

    const prepared = await prepareStrategyFactors(
      `ctx.factor('etf_trend_20', '510300.SH')`,
      'user-1',
      'en',
    );
    expect(prepared.modules[0]).toMatchObject({
      key: 'etf_trend_20',
      analysisKind: 'time_series',
      assetSeries: { window: 21, inputs: ['etf.adjustedClose'] },
    });
  });

  it('carries a published panel factor into the same asset-series strategy runtime', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factor({
        key: 'cross_asset_momentum_120',
        analysisKind: 'panel',
        code: `export default defineFactorV2({
          version: 2,
          name: 'Cross-asset momentum',
          analysisKind: 'panel',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 121,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);

    const prepared = await prepareStrategyFactors(
      `ctx.factor('cross_asset_momentum_120', '510300.SH')`,
      'user-1',
      'en',
    );
    expect(prepared.modules[0]).toMatchObject({
      key: 'cross_asset_momentum_120',
      analysisKind: 'panel',
      assetSeries: { window: 121, inputs: ['etf.adjustedClose'] },
    });
    expect(prepared.factors[0]).toMatchObject({
      key: 'cross_asset_momentum_120',
      analysisKind: 'panel',
      inputs: ['etf.adjustedClose'],
    });
  });

  it('compiles a published panel composite from its frozen approved report bundle', async () => {
    const componentCode = (name: string, periods: number) => `export default defineFactorV2({
      version: 2,
      name: '${name}',
      analysisKind: 'panel',
      outputScope: 'asset',
      frequency: 'daily',
      inputs: ['etf.adjustedClose'],
      targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      window: ${periods + 1},
      compute(ctx) {
        const current = ctx.value('etf.adjustedClose');
        const previous = ctx.lag('etf.adjustedClose', ${periods});
        return current != null && previous != null ? current / previous - 1 : null;
      },
    });`;
    const source = canonicalJson({
      kind: 'panel_composite',
      label: 'Momentum and reversal',
      definition: {
        version: 2,
        key: 'momentum_reversal_panel',
        name: 'Momentum and reversal',
        analysisKind: 'panel',
        standardization: 'rank',
        weighting: 'equal',
        components: [
          { factor: 'component-1', direction: 'positive' },
          { factor: 'component-2', direction: 'negative' },
        ],
      },
      components: [
        {
          factor: 'component-1',
          label: 'Momentum',
          direction: 'positive',
          code: componentCode('Momentum', 20),
        },
        {
          factor: 'component-2',
          label: 'Reversal',
          direction: 'negative',
          code: componentCode('Reversal', 60),
        },
      ],
    });
    mocks.factorFindMany.mockResolvedValue([]);
    mocks.compositeFindMany.mockResolvedValue([
      {
        id: 'composite-1',
        key: 'momentum_reversal_panel',
        name: 'Momentum and reversal',
        status: 'published',
        codeHash: sha256(source),
        approvedReportId: 'report-1',
      },
    ]);
    mocks.reportFindMany.mockResolvedValue([
      {
        id: 'report-1',
        factorCodeSnapshot: source,
        specJson: JSON.stringify({
          version: 1,
          analysisKind: 'panel',
          start: '20200101',
          end: '20241231',
          observationFrequency: 'monthly',
          assets: [
            { assetId: '510300.SH', assetClass: 'cn_equity' },
            { assetId: '511010.SH', assetClass: 'fixed_income' },
            { assetId: '518880.SH', assetClass: 'gold' },
          ],
          target: {
            kind: 'forward_total_return',
            horizon: 20,
            horizonUnit: 'trade_day',
          },
          dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
          rankingScope: 'cross_asset',
          volatilityScaling: 'none',
          minimumAssetsPerPeriod: 3,
          portfolio: {
            topFraction: 0.25,
            bottomFraction: 0.25,
            transactionCostPerSide: 0.001,
          },
        }),
      },
    ]);

    const prepared = await prepareStrategyFactors(
      `ctx.factor('momentum_reversal_panel', '510300.SH')`,
      'user-1',
      'en',
    );

    expect(prepared.modules[0]).toMatchObject({
      key: 'momentum_reversal_panel',
      analysisKind: 'panel',
      assetSeries: { window: 61, inputs: ['etf.adjustedClose'] },
      panelComposite: {
        standardization: 'rank',
        assetUniverse: ['510300.SH', '511010.SH', '518880.SH'],
        components: [
          { direction: 'positive', module: { analysisKind: 'panel' } },
          { direction: 'negative', module: { analysisKind: 'panel' } },
        ],
      },
    });
    expect(prepared.factors).toEqual([
      expect.objectContaining({
        factorId: 'composite-1',
        key: 'momentum_reversal_panel',
        analysisKind: 'panel',
        codeHash: sha256(source),
        approvedReportId: 'report-1',
        inputs: ['etf.adjustedClose'],
      }),
    ]);
  });

  it('freezes time-series inputs for daily signal deployment', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factor({
        key: 'etf_trend_20',
        analysisKind: 'time_series',
        code: `export default defineFactorV2({
          version: 2,
          name: 'ETF trend',
          analysisKind: 'time_series',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 21,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);
    await expect(
      prepareStrategyFactors(
        `ctx.factor('etf_trend_20', '510300.SH')`,
        'user-1',
        'en',
        'deployment',
      ),
    ).resolves.toMatchObject({
      factors: [{ key: 'etf_trend_20', inputs: ['etf.adjustedClose'] }],
    });
  });

  it('allows an archived dependency for an existing signal run', async () => {
    await expect(
      prepareStrategyFactors(`ctx.factor('book_to_market', '000001.SZ')`, 'user-1', 'en', 'signal'),
    ).resolves.toMatchObject({ factors: [{ key: 'book_to_market' }] });
    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['published', 'archived'] } }),
      }),
    );
  });

  it('fails closed for missing or unpublished factors', async () => {
    mocks.factorFindMany.mockResolvedValue([]);
    await expect(
      prepareStrategyFactors(`ctx.factor('book_to_market', '000001.SZ')`, 'user-1', 'en'),
    ).rejects.toThrow('book_to_market');
  });
});
