import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finaFindMany: vi.fn(),
  moneyflowFindMany: vi.fn(),
  topListFindMany: vi.fn(),
  dividendFindMany: vi.fn(),
  recordEvidence: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      finaIndicatorVersion: { findMany: mocks.finaFindMany },
      moneyflow: { findMany: mocks.moneyflowFindMany },
      topList: { findMany: mocks.topListFindMany },
      dividend: { findMany: mocks.dividendFindMany },
      marketRecordEvidence: { findMany: mocks.recordEvidence },
      tradeCal: { findMany: mocks.sessions },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

import {
  loadResearchEquityDividends,
  loadResearchEquityFlows,
  loadResearchEquityFundamentals,
} from './supplemental.js';

describe('Research supplemental datasets', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue([]));
  });

  it('gates fundamentals by captured-version availability and retains the announcement date', async () => {
    mocks.finaFindMany.mockResolvedValue([
      {
        tsCode: '600519.SH',
        endDate: '20251231',
        annDate: '20260330',
        availableDate: '20260402',
        availabilityQuality: 'observed',
        observedAt: new Date('2026-04-01T02:00:00Z'),
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
          availabilityQuality: { not: 'unknown' },
          availableDate: { gte: '20260101', lte: '20261231' },
        },
      }),
    );
    expect(rows[0]).toMatchObject({
      date: '20260402',
      announcement_date: '20260330',
      availability_quality: 'observed',
      observed_at: '2026-04-01T02:00:00.000Z',
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

  it('keeps the dividend ex-date separate from its later captured-version availability', async () => {
    mocks.dividendFindMany.mockResolvedValue([
      {
        id: 'dividend-fixture',
        endDate: '20251231',
        annDate: '20260330',
        exDate: '20260615',
        cashDiv: 2.5,
        cashDivTax: 2.5,
      },
    ]);
    mocks.recordEvidence.mockResolvedValue([
      {
        businessKey: JSON.stringify(['dividend-fixture']),
        firstObservedAt: new Date('2026-06-16T02:00:00Z'),
        availabilityQuality: 'observed',
      },
    ]);
    mocks.sessions.mockResolvedValue([{ calDate: '20260616' }, { calDate: '20260617' }]);

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
    expect(rows[0]).toMatchObject({
      date: '20260617',
      ex_date: '20260615',
      cash_dividend_pre_tax: 2.5,
      observed_at: '2026-06-16T02:00:00.000Z',
      availability_quality: 'observed',
    });
  });
});
