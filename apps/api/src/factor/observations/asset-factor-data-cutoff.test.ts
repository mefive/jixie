import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '#infra/database/prisma.js';
import { resolveAssetFactorDataCutoff } from './asset-factor-data-cutoff.js';

const researchSpec: TimeSeriesFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'time_series',
  start: '20200101',
  end: '20250127',
  observationFrequency: 'daily',
  assets: ['518880.SH', '159980.SZ', '159985.SZ'],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
  inference: { standardError: 'newey_west', lag: 'automatic' },
};

function databaseWithCutoffs(input: {
  etfs: Array<{ tsCode: string; tradeDate: string | null }>;
}): Prisma {
  return {
    etfDaily: {
      groupBy: vi
        .fn()
        .mockResolvedValue(
          input.etfs.map((row) => ({ tsCode: row.tsCode, _max: { tradeDate: row.tradeDate } })),
        ),
    },
  } as unknown as Prisma;
}

const ETF_CUTOFFS = [
  { tsCode: '518880.SH', tradeDate: '20260810' },
  { tsCode: '159980.SZ', tradeDate: '20260807' },
  { tsCode: '159985.SZ', tradeDate: '20260808' },
];

describe('asset-factor data cutoff', () => {
  it('uses the common latest ETF date for price-only factors', async () => {
    const database = databaseWithCutoffs({ etfs: ETF_CUTOFFS });

    await expect(resolveAssetFactorDataCutoff(researchSpec, database)).resolves.toBe('20260807');
  });
});

it('rejects an incomplete ETF universe rather than choosing another asset cutoff', async () => {
  const database = databaseWithCutoffs({ etfs: ETF_CUTOFFS.slice(0, 2) });

  await expect(resolveAssetFactorDataCutoff(researchSpec, database)).resolves.toBeNull();
});

it.each(['20260808', '20260901'])(
  'rejects requested cutoff %s beyond the common ETF history',
  async (dataCutoff) => {
    const spec = { ...researchSpec, dataPolicy: { ...researchSpec.dataPolicy, dataCutoff } };
    const database = databaseWithCutoffs({ etfs: ETF_CUTOFFS });

    await expect(resolveAssetFactorDataCutoff(spec, database)).resolves.toBeNull();
  },
);

it('keeps an earlier explicit data cutoff', async () => {
  const spec = {
    ...researchSpec,
    dataPolicy: { ...researchSpec.dataPolicy, dataCutoff: '20260801' },
  };
  const database = databaseWithCutoffs({ etfs: ETF_CUTOFFS });

  await expect(resolveAssetFactorDataCutoff(spec, database)).resolves.toBe('20260801');
});
