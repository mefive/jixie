import { beforeEach, expect, it, vi } from 'vitest';
import { withDatabase, type Prisma } from '#infra/database/prisma.js';
import { maintainCommodityWarehouseReceipts } from './commodity-warehouse-receipt-maintenance.js';

const dependencies = vi.hoisted(() => ({ sync: vi.fn(), audit: vi.fn(), calendar: vi.fn() }));
vi.mock('./commodity-warehouse-receipts.js', () => ({
  syncCommodityWarehouseReceipts: dependencies.sync,
}));
vi.mock('./commodity-warehouse-receipt-quality.js', () => ({
  auditCommodityWarehouseReceipts: dependencies.audit,
}));

const database = { tradeCal: { findMany: dependencies.calendar } } as unknown as Prisma;
const client = {} as Parameters<typeof maintainCommodityWarehouseReceipts>[0];

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.sync.mockResolvedValue(4);
  dependencies.audit.mockResolvedValue({
    status: 'pass',
    rows: 4,
    products: [],
    warnings: [],
    errors: [],
  });
  dependencies.calendar.mockImplementation(async (query) => {
    const dates = ['20260909', '20260814', '20260731'];
    return (query.take ? dates.slice(0, 2) : dates).map((calDate) => ({ calDate }));
  });
});

it('refreshes a complete explicit repair range instead of truncating it to the rolling window', async () => {
  const summary = await withDatabase(database, () =>
    maintainCommodityWarehouseReceipts(client, '20260909', database, () => {}, {
      startDate: '20260731',
    }),
  );
  expect(summary.startDate).toBe('20260731');
  expect(dependencies.calendar).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: '20260731', lte: '20260909' } },
      take: undefined,
    }),
  );
  expect(dependencies.sync).toHaveBeenCalledWith(
    client,
    '20260731',
    '20260909',
    database,
    expect.any(Function),
  );
  expect(dependencies.audit).toHaveBeenCalledWith(
    { startDate: '20260731', endDate: '20260909', maximumLagTradingDays: 3 },
    database,
  );
});

it('retains the rolling twenty-day window for ordinary maintenance', async () => {
  const summary = await withDatabase(database, () =>
    maintainCommodityWarehouseReceipts(client, '20260909', database, () => {}),
  );
  expect(summary.startDate).toBe('20260814');
  expect(dependencies.calendar).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
});
