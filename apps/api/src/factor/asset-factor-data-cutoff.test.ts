import type { TimeSeriesFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../lib/prisma.js';
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
  futures?: Array<{ tsCode: string; productCode: string; tradeDate: string | null }>;
  warehouseReceipts?: Array<{ productCode: string; availableDate: string | null }>;
}): Prisma {
  return {
    etfDaily: {
      groupBy: vi
        .fn()
        .mockResolvedValue(
          input.etfs.map((row) => ({ tsCode: row.tsCode, _max: { tradeDate: row.tradeDate } })),
        ),
    },
    futureContract: {
      findMany: vi.fn().mockResolvedValue(
        (input.futures ?? []).map((row) => ({
          tsCode: row.tsCode,
          productCode: row.productCode,
        })),
      ),
    },
    futureDaily: {
      groupBy: vi.fn().mockResolvedValue(
        (input.futures ?? []).map((row) => ({
          tsCode: row.tsCode,
          _max: { tradeDate: row.tradeDate },
        })),
      ),
    },
    commodityWarehouseReceipt: {
      groupBy: vi.fn().mockResolvedValue(
        (input.warehouseReceipts ?? []).map((row) => ({
          productCode: row.productCode,
          _max: { availableDate: row.availableDate },
        })),
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

    await expect(resolveAssetFactorDataCutoff(researchSpec, {}, database)).resolves.toBe(
      '20260807',
    );
  });

  it('includes every mapped commodity future when Carry is required', async () => {
    const database = databaseWithCutoffs({
      etfs: ETF_CUTOFFS,
      futures: [
        { tsCode: 'AU2608.SHF', productCode: 'AU', tradeDate: '20260806' },
        { tsCode: 'CU2608.SHF', productCode: 'CU', tradeDate: '20260805' },
        { tsCode: 'M2609.DCE', productCode: 'M', tradeDate: '20260804' },
      ],
    });

    await expect(
      resolveAssetFactorDataCutoff(researchSpec, { commodityCarry: true }, database),
    ).resolves.toBe('20260804');
  });

  it('freezes warehouse research at the earliest product available date', async () => {
    const database = databaseWithCutoffs({
      etfs: ETF_CUTOFFS.map((row) => ({ ...row, tradeDate: '20260810' })),
      warehouseReceipts: [
        { productCode: 'AU', availableDate: '20260810' },
        { productCode: 'CU', availableDate: '20260809' },
        { productCode: 'M', availableDate: '20260808' },
      ],
    });

    await expect(
      resolveAssetFactorDataCutoff(researchSpec, { commodityWarehouseReceipts: true }, database),
    ).resolves.toBe('20260808');
  });

  it('fails closed for excluded SC, missing products, and future requested cutoffs', async () => {
    const database = databaseWithCutoffs({
      etfs: ETF_CUTOFFS,
      warehouseReceipts: [
        { productCode: 'AU', availableDate: '20260810' },
        { productCode: 'CU', availableDate: '20260809' },
      ],
    });

    await expect(
      resolveAssetFactorDataCutoff(researchSpec, { commodityWarehouseReceipts: true }, database),
    ).resolves.toBeNull();
    await expect(
      resolveAssetFactorDataCutoff(
        { ...researchSpec, assets: ['159981.SZ'] },
        { commodityWarehouseReceipts: true },
        database,
      ),
    ).resolves.toBeNull();
    await expect(
      resolveAssetFactorDataCutoff(
        {
          ...researchSpec,
          dataPolicy: { ...researchSpec.dataPolicy, dataCutoff: '20260811' },
        },
        {},
        database,
      ),
    ).resolves.toBeNull();
  });
});
