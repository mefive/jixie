import type { MacroRegimeFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../lib/prisma.js';
import { resolveMacroRegimeDataCutoff } from './macro-regime-data-cutoff.js';

const researchSpec: MacroRegimeFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'macro_regime',
  start: '20200101',
  end: '20241231',
  observationFrequency: 'monthly',
  targetAssets: ['510300.SH', '511010.SH'],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
  stateModel: { kind: 'threshold', states: 4 },
};

function databaseWithLatestDates(
  macroDate: string | null,
  assetDates: Array<{ tsCode: string; tradeDate: string | null }>,
): Prisma {
  return {
    macroObservation: {
      aggregate: vi.fn().mockResolvedValue({ _max: { vintageDate: macroDate } }),
    },
    etfDaily: {
      groupBy: vi.fn().mockResolvedValue(
        assetDates.map(({ tsCode, tradeDate }) => ({
          tsCode,
          _max: { tradeDate },
        })),
      ),
    },
  } as unknown as Prisma;
}

describe('resolveMacroRegimeDataCutoff', () => {
  it('freezes the snapshot at the latest observed source date', async () => {
    const database = databaseWithLatestDates('20250131', [
      { tsCode: '510300.SH', tradeDate: '20250207' },
      { tsCode: '511010.SH', tradeDate: '20250206' },
    ]);

    await expect(resolveMacroRegimeDataCutoff(researchSpec, database)).resolves.toBe('20250207');
  });

  it('does not censor a macro vintage captured after the latest ETF market date', async () => {
    const database = databaseWithLatestDates('20260809', [
      { tsCode: '510300.SH', tradeDate: '20260724' },
      { tsCode: '511010.SH', tradeDate: '20260806' },
    ]);

    await expect(resolveMacroRegimeDataCutoff(researchSpec, database)).resolves.toBe('20260809');
  });

  it('rejects an explicit cutoff beyond the latest observed source date', async () => {
    const database = databaseWithLatestDates('20250131', [
      { tsCode: '510300.SH', tradeDate: '20250207' },
      { tsCode: '511010.SH', tradeDate: '20250206' },
    ]);

    await expect(
      resolveMacroRegimeDataCutoff(
        { ...researchSpec, dataPolicy: { ...researchSpec.dataPolicy, dataCutoff: '20250208' } },
        database,
      ),
    ).resolves.toBeNull();
  });

  it('fails closed when any target asset lacks data', async () => {
    const database = databaseWithLatestDates('20250131', [
      { tsCode: '510300.SH', tradeDate: '20250207' },
    ]);

    await expect(resolveMacroRegimeDataCutoff(researchSpec, database)).resolves.toBeNull();
  });
});
