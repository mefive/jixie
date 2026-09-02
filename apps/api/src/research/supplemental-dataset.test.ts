import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  marketFindMany: vi.fn(),
  indexFindMany: vi.fn(),
  finaFindMany: vi.fn(),
  moneyflowFindMany: vi.fn(),
  topListFindMany: vi.fn(),
  dividendFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    marketIndicator: { findMany: mocks.marketFindMany },
    indexIndicator: { findMany: mocks.indexFindMany },
    finaIndicator: { findMany: mocks.finaFindMany },
    moneyflow: { findMany: mocks.moneyflowFindMany },
    topList: { findMany: mocks.topListFindMany },
    dividend: { findMany: mocks.dividendFindMany },
  },
}));

import {
  loadResearchEquityDividends,
  loadResearchEquityFlows,
  loadResearchEquityFundamentals,
  loadResearchMarketState,
} from './supplemental-dataset.js';

describe('Research supplemental datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('loads market state with a warm-up window and stable components', async () => {
    mocks.marketFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        tradeDate: `202601${String(index + 1).padStart(2, '0')}`,
        tradedCount: 100,
        return20: 0.05,
        advanceRatio: 0.6,
        aboveMa20Ratio: 0.7,
        aboveMa60Ratio: 0.5,
        totalAmount: 1000,
        floatWeightedTurnoverRate: 2,
        topFivePercentAmountShare: 0.3,
        extremeMoveRatio: 0.1,
        limitUpCount: 5,
        limitDownCount: 1,
      })),
    );

    const rows = await loadResearchMarketState({
      scope: 'all',
      start: '20260120',
      end: '20260131',
    });

    expect(mocks.marketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tradeDate: { gte: '20251206', lte: '20260131' } },
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        date: '20260120',
        activity: 2,
        breadth: 0.6,
        trend: 0.05,
        crowding: 0.3,
      }),
    ]);
  });

  it('gates fundamentals by announcement date', async () => {
    mocks.finaFindMany.mockResolvedValue([
      {
        tsCode: '600519.SH',
        endDate: '20251231',
        annDate: '20260330',
        roe: 30,
        roeWaa: 29,
        roa: 20,
        grossprofitMargin: 90,
        netprofitMargin: 50,
        debtToAssets: 20,
        orYoy: 10,
        netprofitYoy: 12,
        ocfToProfit: 1.1,
      },
    ]);

    const rows = await loadResearchEquityFundamentals({
      identifier: '600519.SH',
      start: '20260101',
      end: '20261231',
    });

    expect(mocks.finaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tsCode: '600519.SH',
          annDate: { not: null, gte: '20260101', lte: '20261231' },
        },
      }),
    );
    expect(rows[0]).toMatchObject({
      date: '20260330',
      report_period: '20251231',
      roe_pct: 30,
      revenue_yoy_pct: 10,
    });
  });

  it('joins only exact-date flow and Dragon-Tiger List observations', async () => {
    mocks.moneyflowFindMany.mockResolvedValue([
      { tradeDate: '20260701', netMain: 12, netTotal: 8 },
    ]);
    mocks.topListFindMany.mockResolvedValue([{ tradeDate: '20260702', netAmount: 1_000_000 }]);

    await expect(
      loadResearchEquityFlows({
        identifier: '600519.SH',
        start: '20260701',
        end: '20260731',
      }),
    ).resolves.toEqual([
      {
        date: '20260701',
        net_main_cny_10k: 12,
        net_total_cny_10k: 8,
        dragon_tiger_net_cny: null,
      },
      {
        date: '20260702',
        net_main_cny_10k: null,
        net_total_cny_10k: null,
        dragon_tiger_net_cny: 1_000_000,
      },
    ]);
  });

  it('returns implemented dividends by ex-date only', async () => {
    mocks.dividendFindMany.mockResolvedValue([
      {
        endDate: '20251231',
        annDate: '20260330',
        exDate: '20260615',
        cashDiv: 2.5,
        cashDivTax: 2.5,
      },
    ]);

    const rows = await loadResearchEquityDividends({
      identifier: '600519.SH',
      start: '20260101',
      end: '20261231',
    });

    expect(mocks.dividendFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ divProc: '实施', exDate: expect.any(Object) }),
      }),
    );
    expect(rows[0]).toMatchObject({ date: '20260615', cash_dividend_pre_tax: 2.5 });
  });
});
