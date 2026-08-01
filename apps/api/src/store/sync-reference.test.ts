import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TushareClient } from '../tushare/client.js';

const mocks = vi.hoisted(() => ({
  finaIndicatorApi: vi.fn(),
  finaIndicatorVipApi: vi.fn(),
  dividendApi: vi.fn(),
  finaFindMany: vi.fn(),
  finaCreateMany: vi.fn(),
  finaUpdate: vi.fn(),
  dividendFindMany: vi.fn(),
  dividendDeleteMany: vi.fn(),
  dividendCreateMany: vi.fn(),
  dailyGroupBy: vi.fn(),
}));

vi.mock('../tushare/api.js', () => ({
  finaIndicator: mocks.finaIndicatorApi,
  finaIndicatorVip: mocks.finaIndicatorVipApi,
  dividend: mocks.dividendApi,
}));

vi.mock('../lib/prisma.js', () => {
  const transactionClient = {
    finaIndicator: {
      createMany: mocks.finaCreateMany,
      update: mocks.finaUpdate,
    },
  };
  return {
    prisma: {
      finaIndicator: {
        findMany: mocks.finaFindMany,
        createMany: mocks.finaCreateMany,
        update: mocks.finaUpdate,
      },
      dividend: {
        findMany: mocks.dividendFindMany,
        deleteMany: mocks.dividendDeleteMany,
        createMany: mocks.dividendCreateMany,
      },
      daily: {
        groupBy: mocks.dailyGroupBy,
      },
      $transaction: vi.fn(async (input) =>
        typeof input === 'function' ? input(transactionClient) : Promise.all(input),
      ),
    },
  };
});

const { stockCodesWithDailyData, syncDividend, syncFinaIndicator, syncFinaIndicatorVip } =
  await import('./sync.js');
const client = {} as TushareClient;

describe('incremental financial reference synchronization', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.finaCreateMany.mockResolvedValue({ count: 0 });
    mocks.finaUpdate.mockResolvedValue({});
    mocks.dividendDeleteMany.mockResolvedValue({ count: 0 });
    mocks.dividendCreateMany.mockResolvedValue({ count: 0 });
  });

  it('does not rewrite an unchanged financial history', async () => {
    const stored = financialRow();
    mocks.finaIndicatorApi.mockResolvedValue([financialApiRow()]);
    mocks.finaFindMany.mockResolvedValue([stored]);

    const summary = await syncFinaIndicator(client, ['000001.SZ'], {
      refreshExisting: true,
    });

    expect(summary).toMatchObject({ processed: 1, changed: 0, created: 0, updated: 0 });
    expect(mocks.finaCreateMany).not.toHaveBeenCalled();
    expect(mocks.finaUpdate).not.toHaveBeenCalled();
  });

  it('deduplicates the Daily universe inside SQLite', async () => {
    mocks.dailyGroupBy.mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }]);

    await expect(stockCodesWithDailyData()).resolves.toEqual(['000001.SZ', '000002.SZ']);
    expect(mocks.dailyGroupBy).toHaveBeenCalledWith({
      by: ['tsCode'],
      orderBy: { tsCode: 'asc' },
    });
  });

  it('updates only a changed financial report period', async () => {
    mocks.finaIndicatorApi.mockResolvedValue([financialApiRow({ roe: 12 })]);
    mocks.finaFindMany.mockResolvedValue([financialRow()]);

    const summary = await syncFinaIndicator(client, ['000001.SZ'], {
      refreshExisting: true,
    });

    expect(summary).toMatchObject({ processed: 1, changed: 1, created: 0, updated: 1 });
    expect(mocks.finaUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.finaCreateMany).not.toHaveBeenCalled();
  });

  it('prefers the revised VIP row and updates a whole report period by diff', async () => {
    mocks.finaIndicatorVipApi.mockResolvedValue([
      financialApiRow({ roe: 10, update_flag: '0' }),
      financialApiRow({ roe: 12, update_flag: '1' }),
    ]);
    mocks.finaFindMany.mockResolvedValue([financialRow()]);

    const summary = await syncFinaIndicatorVip(client, ['20260331']);

    expect(summary).toMatchObject({ processed: 1, changed: 1, updated: 1 });
    expect(mocks.finaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roe: 12 }) }),
    );
  });

  it('does not replace an unchanged dividend history', async () => {
    const row = dividendRow();
    mocks.dividendApi.mockResolvedValue([
      {
        ts_code: row.tsCode,
        end_date: row.endDate,
        ann_date: row.annDate,
        ex_date: row.exDate,
        imp_ann_date: '20260601',
        div_proc: row.divProc,
        cash_div: row.cashDiv,
        cash_div_tax: row.cashDivTax,
      },
    ]);
    mocks.dividendFindMany.mockResolvedValue([row]);

    const summary = await syncDividend(client, ['000001.SZ'], { refreshExisting: true });

    expect(summary).toMatchObject({ processed: 1, changed: 0, created: 0, deleted: 0 });
    expect(mocks.dividendDeleteMany).not.toHaveBeenCalled();
    expect(mocks.dividendCreateMany).not.toHaveBeenCalled();
  });
});

function financialRow(overrides: Record<string, unknown> = {}) {
  return {
    tsCode: '000001.SZ',
    endDate: '20260331',
    annDate: '20260430',
    roe: 10,
    roeWaa: 9,
    roa: 1,
    grossprofitMargin: 30,
    netprofitMargin: 20,
    debtToAssets: 80,
    orYoy: 5,
    netprofitYoy: 6,
    ocfToProfit: 1.2,
    ...overrides,
  };
}

function financialApiRow(overrides: Record<string, unknown> = {}) {
  const row = financialRow(overrides);
  return {
    ts_code: row.tsCode,
    end_date: row.endDate,
    ann_date: row.annDate,
    roe: row.roe,
    roe_waa: row.roeWaa,
    roa: row.roa,
    grossprofit_margin: row.grossprofitMargin,
    netprofit_margin: row.netprofitMargin,
    debt_to_assets: row.debtToAssets,
    or_yoy: row.orYoy,
    netprofit_yoy: row.netprofitYoy,
    ocf_to_profit: row.ocfToProfit,
    update_flag: (overrides.update_flag as string | undefined) ?? '0',
  };
}

function dividendRow() {
  return {
    tsCode: '000001.SZ',
    endDate: '20251231',
    annDate: '20260315',
    exDate: '20260615',
    divProc: '实施',
    cashDiv: 0.2,
    cashDivTax: 0.25,
  };
}
