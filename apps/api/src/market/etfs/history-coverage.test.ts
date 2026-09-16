import { describe, expect, it } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import { inspectEtfHistoryCoverage } from './history-coverage.js';

describe('ETF expected-key coverage', () => {
  it('detects interior and per-code holes despite matching endpoints and nonempty dates', async () => {
    const rows = [
      { tsCode: 'old', tradeDate: '20260105' },
      { tsCode: 'old', tradeDate: '20260107' },
    ];
    const database = {
      etfDaily: { findMany: async () => rows },
      etfAdjFactor: { findMany: async () => [...rows, { tsCode: 'old', tradeDate: '20260106' }] },
      etfShareSize: { findMany: async () => rows },
    } as unknown as Prisma;
    const gaps = await inspectEtfHistoryCoverage(
      database,
      [
        { tsCode: 'old', listDate: '20100101', delistDate: '20260106' },
        { tsCode: 'new', listDate: '20260106', delistDate: null },
        { tsCode: 'future', listDate: '20260201', delistDate: null },
      ],
      ['20260105', '20260106', '20260107'],
    );
    expect(gaps[0].daily).toEqual([]);
    expect(gaps[1]).toEqual({
      tradeDate: '20260106',
      activeCodes: ['old', 'new'],
      daily: ['old', 'new'],
      adjustment: ['new'],
      shareSize: ['old', 'new'],
    });
    expect(gaps[2].activeCodes).toEqual(['new']);
  });

  it('rejects missing lifecycle metadata rather than silently skipping a product', async () => {
    await expect(
      inspectEtfHistoryCoverage(
        {} as Prisma,
        [{ tsCode: 'unknown', listDate: null, delistDate: null }],
        ['20260105'],
      ),
    ).rejects.toThrow('listing date');
  });
});
