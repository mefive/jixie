import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finaFindMany: vi.fn(),
  dividendFindMany: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      finaIndicatorVersion: { findMany: mocks.finaFindMany },
      dividend: { findMany: mocks.dividendFindMany },
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

import { loadResearchEquityDividends, loadResearchEquityFundamentals } from './supplemental.js';

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
          availableDate: { lte: '20261231' },
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

  it('keeps the dividend ex-date separate from its later captured-version availability', async () => {
    mocks.dividendFindMany.mockResolvedValue([
      {
        id: 'dividend-fixture',
        endDate: '20251231',
        annDate: '20260330',
        exDate: '20260615',
        cashDiv: 2.5,
        cashDivTax: 2.5,
        observedAt: new Date('2026-06-16T02:00:00Z'),
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

const cashImplementation = {
  id: 'first-notice',
  tsCode: '002326.SZ',
  endDate: '20181231',
  annDate: '20190429',
  exDate: '20190820',
  recordDate: '20190819',
  payDate: '20190820',
  implementationAnnouncementDate: '20190814',
  distributionKind: 'cash',
  cashDiv: 0.15,
  cashDivTax: 0.15,
  baseShare: 82009.3827,
  stockDividend: 0,
  stockBonusRate: null,
  stockCapitalizationRate: null,
  observedAt: new Date('2026-06-16T02:00:00Z'),
  availabilityQuality: 'latest_only',
};

function mockCashImplementations(rows: object[]) {
  mocks.dividendFindMany.mockResolvedValue(rows);
  mocks.sessions.mockResolvedValue([
    { calDate: '20260617' },
    { calDate: '20260618' },
    { calDate: '20260619' },
  ]);
}

it.each([false, true])(
  'returns Yongtai cash once while retaining source announcements, reversed=%s',
  async (reversed) => {
    const rows = [
      cashImplementation,
      { ...cashImplementation, id: 'second-notice', annDate: '20190806' },
    ];
    mockCashImplementations(reversed ? rows.reverse() : rows);
    const result = await loadResearchEquityDividends({
      identifier: '002326.SZ',
      start: '20260101',
      end: '20261231',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ cash_dividend_pre_tax: 0.15, announcement_date: '20190429' });
  },
);

it('does not emit a repeated later capture as another payment inside a later window', async () => {
  mockCashImplementations([
    cashImplementation,
    {
      ...cashImplementation,
      id: 'later',
      annDate: '20190806',
      observedAt: new Date('2026-06-18T02:00:00Z'),
    },
  ]);
  expect(
    await loadResearchEquityDividends({
      identifier: '002326.SZ',
      start: '20260618',
      end: '20260619',
    }),
  ).toEqual([]);
});

it('does not allow a future capture to alter earlier visible cash', async () => {
  mockCashImplementations([
    cashImplementation,
    {
      ...cashImplementation,
      id: 'future',
      cashDivTax: 0.2,
      observedAt: new Date('2026-06-18T02:00:00Z'),
    },
  ]);
  expect(
    await loadResearchEquityDividends({
      identifier: '002326.SZ',
      start: '20260101',
      end: '20260617',
    }),
  ).toHaveLength(1);
});

it.each([
  { cashDivTax: 0.2 },
  { baseShare: 51277.8827 },
  { recordDate: null },
  { payDate: null },
  { cashDivTax: null },
])(
  'refuses ambiguous cash implementations rather than summing or overwriting: %j',
  async (changed) => {
    mockCashImplementations([
      cashImplementation,
      { ...cashImplementation, id: 'ambiguous', ...changed },
    ]);
    await expect(
      loadResearchEquityDividends({ identifier: '002326.SZ', start: '20260101', end: '20261231' }),
    ).rejects.toMatchObject({ reason: 'ambiguous_dividend_event' });
  },
);

it('retains different payment dates, excludes pure stock distributions and emits mixed cash once', async () => {
  const mixed = {
    ...cashImplementation,
    distributionKind: 'mixed',
    stockDividend: 0.12,
    stockCapitalizationRate: 0.12,
  };
  mockCashImplementations([
    mixed,
    { ...mixed, id: 'second', annDate: '20190806' },
    { ...cashImplementation, id: 'other-payment', payDate: '20190821' },
    {
      ...cashImplementation,
      id: 'stock',
      distributionKind: 'shares',
      cashDiv: 0,
      cashDivTax: 0,
      stockDividend: 0.12,
    },
  ]);
  const result = await loadResearchEquityDividends({
    identifier: '002326.SZ',
    start: '20260101',
    end: '20261231',
  });
  expect(result).toHaveLength(2);
  expect(result.map((row) => row.cash_dividend_pre_tax)).toEqual([0.15, 0.15]);
});
