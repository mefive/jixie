import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  returnsFindMany: vi.fn(),
  receiptsFindMany: vi.fn(),
  holdingsFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    commodityContinuousReturn: { findMany: mocks.returnsFindMany },
    commodityWarehouseReceipt: { findMany: mocks.receiptsFindMany },
    commodityHoldingPosition: { findMany: mocks.holdingsFindMany },
  },
}));

import {
  loadResearchCommodityHoldings,
  loadResearchCommodityReturns,
  loadResearchCommodityWarehouseReceipts,
} from './commodity-dataset.js';

describe('Research commodity datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('loads continuous returns by availability date and emits stable snake-case columns', async () => {
    mocks.returnsFindMany.mockResolvedValue([
      {
        availableDate: '20260702',
        tradeDate: '20260701',
        productCode: 'AU',
        continuousCode: 'AU.SHF',
        mappedContract: 'AU2608.SHF',
        continuousReturn: 0.01,
        continuousLogReturn: 0.00995,
        mappedLogReturn: 0.012,
        rollGapLogReturn: 0.00205,
        rollYieldProxy: -0.00205,
        mappingChanged: true,
      },
    ]);

    const rows = await loadResearchCommodityReturns({
      product: 'AU',
      start: '20260702',
      end: '20260731',
    });

    expect(mocks.returnsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productCode: 'AU', availableDate: { gte: '20260702', lte: '20260731' } },
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        date: '20260702',
        trade_date: '20260701',
        mapped_contract: 'AU2608.SHF',
        roll_yield_proxy: -0.00205,
        mapping_changed: true,
      }),
    ]);
  });

  it('preserves warehouse-receipt units and corrections', async () => {
    mocks.receiptsFindMany.mockResolvedValue([
      {
        availableDate: '20260702',
        tradeDate: '20260701',
        productCode: 'SC',
        unit: '桶',
        volume: 123,
        volumeChange: -4,
        unitCorrectionApplied: false,
      },
    ]);

    await expect(
      loadResearchCommodityWarehouseReceipts({
        product: 'SC',
        start: '20260702',
        end: '20260731',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ unit: '桶', volume_change: -4, unit_correction_applied: false }),
    ]);
  });

  it('exposes ranked-member aggregates without presenting them as whole-market holdings', async () => {
    mocks.holdingsFindMany.mockResolvedValue([
      {
        availableDate: '20260702',
        tradeDate: '20260701',
        productCode: 'M',
        referenceContract: 'M2609.DCE',
        contractOpenInterest: 1000,
        contractVolume: 800,
        rankedVolume: 500,
        rankedVolumeChange: null,
        rankedLongHolding: 400,
        rankedLongChange: 10,
        rankedShortHolding: 390,
        rankedShortChange: -5,
        topFiveLongHolding: 180,
        topFiveShortHolding: 175,
        volumeMemberCount: 20,
        longMemberCount: 20,
        shortMemberCount: 20,
        sourceCorrectionApplied: false,
      },
    ]);

    await expect(
      loadResearchCommodityHoldings({
        product: 'M',
        start: '20260702',
        end: '20260731',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        reference_contract: 'M2609.DCE',
        ranked_long_holding: 400,
        ranked_short_holding: 390,
      }),
    ]);
  });
});
