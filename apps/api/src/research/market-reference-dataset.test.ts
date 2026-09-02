import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  etfShares: vi.fn(),
  indexValuation: vi.fn(),
  industryState: vi.fn(),
  futuresSettlement: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    etfShareSize: { findMany: mocks.etfShares },
    indexDailyBasic: { findMany: mocks.indexValuation },
    industryIndicator: { findMany: mocks.industryState },
    futureSettlement: { findMany: mocks.futuresSettlement },
  },
}));

import {
  loadResearchEtfShares,
  loadResearchFuturesSettlement,
  loadResearchIndexValuation,
  loadResearchIndustryState,
} from './market-reference-dataset.js';

const request = { identifier: 'TEST', start: '20260101', end: '20261231' };

describe('Research market reference datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('gates ETF share history by availability date', async () => {
    mocks.etfShares.mockResolvedValue([
      {
        availableDate: '20260106',
        tradeDate: '20260105',
        totalShare: 100,
        totalSize: 120,
        nav: 1.2,
        close: 1.19,
        exchange: 'SH',
      },
    ]);

    await expect(loadResearchEtfShares(request)).resolves.toEqual([
      expect.objectContaining({ date: '20260106', trade_date: '20260105', total_share_10k: 100 }),
    ]);
    expect(mocks.etfShares).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availableDate: { gte: '20260101', lte: '20261231' } }),
      }),
    );
  });

  it('maps provider index valuation fields without reconstruction', async () => {
    mocks.indexValuation.mockResolvedValue([
      {
        tradeDate: '20260105',
        totalMv: 100,
        floatMv: 80,
        totalShare: 10,
        floatShare: 8,
        freeShare: 6,
        turnoverRate: 1.2,
        turnoverRateF: 1.5,
        pe: 12,
        peTtm: 11,
        pb: 1.4,
      },
    ]);

    await expect(loadResearchIndexValuation(request)).resolves.toEqual([
      expect.objectContaining({ date: '20260105', pe_ttm: 11, total_mv_cny: 100 }),
    ]);
  });

  it('accepts an exact industry code or name', async () => {
    mocks.industryState.mockResolvedValue([
      {
        tradeDate: '20260105',
        l1Code: '801120.SI',
        l1Name: '食品饮料',
        tradedCount: 100,
        return20: 0.03,
        excessReturn20: 0.01,
        positiveReturn20Ratio: 0.6,
        aboveMa20Ratio: 0.55,
        aboveMa60Ratio: 0.5,
        floatWeightedTurnoverRate: 1.1,
        amountShare: 0.04,
        topFiveAmountShare: 0.2,
      },
    ]);

    await loadResearchIndustryState({ ...request, identifier: '食品饮料' });
    expect(mocks.industryState).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ l1Code: '食品饮料' }, { l1Name: '食品饮料' }] }),
      }),
    );
  });

  it('preserves exchange margin rates as provider percentage points', async () => {
    mocks.futuresSettlement.mockResolvedValue([
      {
        tradeDate: '20260105',
        settle: 4000,
        tradingFeeRate: 0.0001,
        tradingFee: null,
        deliveryFee: null,
        buyHedgeMarginRate: 12,
        sellHedgeMarginRate: 13,
        longMarginRate: 14,
        shortMarginRate: 15,
        closeTodayFee: null,
        exchange: 'CFX',
      },
    ]);

    await expect(loadResearchFuturesSettlement(request)).resolves.toEqual([
      expect.objectContaining({ buy_hedge_margin_rate_pct: 12, short_margin_rate_pct: 15 }),
    ]);
  });
});
