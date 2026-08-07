import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ factorFindMany: vi.fn() }));

vi.mock('../lib/prisma.js', () => ({
  prisma: { factor: { findMany: mocks.factorFindMany } },
}));

import { extractFactorKeys, prepareStrategyFactors } from './prepare-custom-factors.js';

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
      timeSeries: { window: 21, inputs: ['etf.adjustedClose'] },
    });
  });

  it('keeps time-series factors out of daily signal deployment', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factor({ key: 'etf_trend_20', analysisKind: 'time_series' }),
    ]);
    await expect(
      prepareStrategyFactors(
        `ctx.factor('etf_trend_20', '510300.SH')`,
        'user-1',
        'en',
        'deployment',
      ),
    ).rejects.toThrow(/research backtests but not yet for daily signal deployment/);
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
