import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dependencies = vi.hoisted(() => ({
  assertProductionLock: vi.fn(),
  latestCompletedTradeDate: vi.fn(),
  getRecentOpenDates: vi.fn(),
  beginMaintenanceRun: vi.fn(),
  finishMaintenanceRun: vi.fn(),
  startMaintenanceHeartbeat: vi.fn(),
  updateMaintenanceRun: vi.fn(),
  waitForRunningWork: vi.fn(),
  refreshMarketDate: vi.fn(),
  prepareSignalEtfMarketDate: vi.fn(),
  refreshCommodityHoldingPositions: vi.fn(),
  syncCommodityContinuousReturns: vi.fn(),
  syncExternalMarketDrivers: vi.fn(),
  syncCrossMarketBenchmarks: vi.fn(),
  syncChinaTreasuryYieldCurve: vi.fn(),
  syncChinaBondCreditCurves: vi.fn(),
  syncMarketIndicators: vi.fn(),
  validateDerivedMarketRange: vi.fn(),
  runDataQualityAudit: vi.fn(),
  bumpDataRevision: vi.fn(),
  syncTradeCal: vi.fn(),
  syncStockBasic: vi.fn(),
  syncStockNameHistory: vi.fn(),
  prepareIndexMembership: vi.fn(),
  maintainCommodityWarehouseReceipts: vi.fn(),
  dates: vi.fn(),
  state: vi.fn(),
}));
vi.mock('../runs/coordination.js', () => dependencies);
vi.mock('../runs/state.js', () => dependencies);
vi.mock('#market/calendar/sse-close.js', () => dependencies);
vi.mock('#market/calendar/read.js', () => dependencies);
vi.mock('#market/calendar/sync.js', () => dependencies);
vi.mock('#market/stocks/basic-sync.js', () => dependencies);
vi.mock('#market/indices/prepare-membership.js', () => dependencies);
vi.mock('../publication/gate.js', () => ({ indexWeightMaximumAgeDays: () => 190 }));
vi.mock('#market/providers/tushare/config.js', () => ({
  loadTushareConfig: () => ({ token: 'fixture', baseUrl: 'http://invalid', minIntervalMs: 1 }),
}));
vi.mock('#market/providers/tushare/tushare-client.js', () => ({ TushareClient: class {} }));
vi.mock('#market/commodity/commodity-warehouse-receipt-maintenance.js', () => dependencies);
vi.mock('#market/state/sync.js', () => dependencies);
vi.mock('#market/state/quality.js', () => dependencies);
vi.mock('./refresh-market-date.js', () => dependencies);
vi.mock('#signals/daily/sync.js', () => dependencies);
vi.mock('#market/commodity/holding-sync.js', () => dependencies);
vi.mock('#market/commodity/commodity-continuous-returns.js', () => dependencies);
vi.mock('#market/cross-market/benchmark-sync.js', () => dependencies);
vi.mock('#market/cross-market/external-drivers.js', () => dependencies);
vi.mock('#market/rates/china-treasury-curve.js', () => ({
  ...dependencies,
  MinistryOfFinanceCurveClient: class {},
}));
vi.mock('#market/rates/chinabond-credit-curves.js', () => ({
  ...dependencies,
  ChinaBondPublicCurveClient: class {},
}));
vi.mock('../publication/audit.js', () => dependencies);
vi.mock('../publication/watermark.js', () => dependencies);
vi.mock('#infra/database/prisma.js', async () => {
  const mocked = {
    prisma: {
      tradeCal: { findMany: dependencies.dates },
      maintenanceState: { findUnique: dependencies.state, updateMany: vi.fn() },
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
import { runRepairMaintenance } from './repair.js';

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.finishMaintenanceRun.mockResolvedValue(undefined);
  dependencies.latestCompletedTradeDate.mockResolvedValue('20261019');
  dependencies.getRecentOpenDates.mockResolvedValue(['20261016', '20261019']);
  dependencies.dates.mockResolvedValue([{ calDate: '20261016' }, { calDate: '20261019' }]);
  dependencies.beginMaintenanceRun.mockResolvedValue({ id: 'repair', skipped: false });
  dependencies.startMaintenanceHeartbeat.mockReturnValue(async () => {});
  dependencies.refreshMarketDate.mockResolvedValue({ core: {}, quality: {} });
  dependencies.prepareSignalEtfMarketDate.mockImplementation(async (_, tradeDate) => ({
    tradeDate,
  }));
  dependencies.runDataQualityAudit.mockResolvedValue({ findings: [] });
  dependencies.state.mockResolvedValue({ dailyPublishedThrough: '20261020' });
});
afterEach(() => vi.unstubAllEnvs());

describe('unified repair', () => {
  it('refreshes the twenty completed trading days selected by default', async () => {
    await runRepairMaintenance();
    expect(dependencies.getRecentOpenDates).toHaveBeenCalledWith('20261019', 20);
    expect(dependencies.refreshMarketDate).toHaveBeenCalledTimes(2);
    expect(dependencies.beginMaintenanceRun).toHaveBeenCalledOnce();
    expect(dependencies.beginMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'repair', startDate: '20261016', endDate: '20261019' }),
    );
    expect(dependencies.bumpDataRevision).toHaveBeenCalledOnce();
    expect(dependencies.syncStockBasic).toHaveBeenCalledOnce();
    expect(dependencies.syncStockNameHistory).toHaveBeenCalledWith(
      expect.anything(),
      '19900101',
      '20261019',
    );
    expect(dependencies.prepareIndexMembership).toHaveBeenCalledWith(
      expect.anything(),
      ['20261016', '20261019'],
      190,
    );
    expect(dependencies.prepareIndexMembership.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.refreshMarketDate.mock.invocationCallOrder[0],
    );
  });

  it('prepares each dependency range once and retains each ETF preflight candidate', async () => {
    await runRepairMaintenance({ startDate: '20261016', endDate: '20261019' });
    for (const prepare of [
      dependencies.refreshCommodityHoldingPositions,
      dependencies.syncExternalMarketDrivers,
      dependencies.syncCrossMarketBenchmarks,
      dependencies.syncChinaTreasuryYieldCurve,
      dependencies.syncChinaBondCreditCurves,
    ]) {
      expect(prepare).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        '20261016',
        '20261019',
        expect.any(Function),
      );
    }
    expect(dependencies.syncCommodityContinuousReturns).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      '20261016',
      '20261019',
      expect.anything(),
      expect.any(Function),
    );
    expect(dependencies.maintainCommodityWarehouseReceipts).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      '20261019',
      expect.anything(),
      expect.any(Function),
      { startDate: '20261016' },
    );
    expect(dependencies.prepareSignalEtfMarketDate.mock.invocationCallOrder.at(-1)).toBeLessThan(
      dependencies.refreshMarketDate.mock.invocationCallOrder[0],
    );
    expect(dependencies.refreshCommodityHoldingPositions.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.syncCommodityContinuousReturns.mock.invocationCallOrder[0],
    );
    for (const [index, tradeDate] of ['20261016', '20261019'].entries()) {
      expect(dependencies.refreshMarketDate).toHaveBeenNthCalledWith(
        index + 1,
        expect.anything(),
        tradeDate,
        expect.objectContaining({ preparedEtf: { tradeDate } }),
      );
    }
    expect(dependencies.syncMarketIndicators).toHaveBeenCalledExactlyOnceWith(
      '20261016',
      '20261019',
    );
  });

  it('prepares commodity inputs when advancing one day beyond the existing coverage', async () => {
    dependencies.dates.mockResolvedValue([{ calDate: '20260910' }]);
    await runRepairMaintenance({ startDate: '20260910', endDate: '20260910' });
    expect(dependencies.refreshCommodityHoldingPositions).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      '20260910',
      '20260910',
      expect.any(Function),
    );
    expect(dependencies.refreshCommodityHoldingPositions.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.runDataQualityAudit.mock.invocationCallOrder[0],
    );
  });

  it('does not report completion or audit a partially refreshed range', async () => {
    dependencies.refreshMarketDate.mockRejectedValueOnce(new Error('source unavailable'));
    await expect(runRepairMaintenance()).rejects.toThrow('source unavailable');
    expect(dependencies.finishMaintenanceRun).toHaveBeenCalledWith(
      'repair',
      'error',
      expect.objectContaining({ error: 'source unavailable' }),
    );
    expect(dependencies.runDataQualityAudit).not.toHaveBeenCalled();
    expect(dependencies.bumpDataRevision).not.toHaveBeenCalled();
  });

  it('does not refresh daily rows if constituent preparation fails', async () => {
    dependencies.prepareIndexMembership.mockRejectedValue(new Error('Missing PIT snapshot'));
    await expect(runRepairMaintenance()).rejects.toThrow('Missing PIT snapshot');
    expect(dependencies.refreshMarketDate).not.toHaveBeenCalled();
    expect(dependencies.runDataQualityAudit).not.toHaveBeenCalled();
  });

  it('defers calculation and audit to the coordinator for staged repair', async () => {
    await runRepairMaintenance({
      startDate: '20261016',
      endDate: '20261019',
      deferPublication: true,
    });
    expect(dependencies.refreshMarketDate).toHaveBeenCalledTimes(2);
    expect(dependencies.syncMarketIndicators).not.toHaveBeenCalled();
    expect(dependencies.runDataQualityAudit).not.toHaveBeenCalled();
  });

  it('rejects an unfinished date before refreshing market data', async () => {
    dependencies.dates.mockResolvedValue([{ calDate: '20261020' }]);
    await expect(
      runRepairMaintenance({ startDate: '20261020', endDate: '20261020' }),
    ).rejects.toThrow('has not completed');
    expect(dependencies.refreshMarketDate).not.toHaveBeenCalled();
  });
});
