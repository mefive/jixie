import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const dependencies = vi.hoisted(() => ({
  assertProductionLock: vi.fn(),
  latestCompletedTradeDate: vi.fn(),
  getRecentOpenDates: vi.fn(),
  beginMaintenanceRun: vi.fn(),
  finishMaintenanceRun: vi.fn(),
  startMaintenanceHeartbeat: vi.fn(),
  updateMaintenanceRun: vi.fn(),
  selfHealMarketDates: vi.fn(),
  runDailyMaintenance: vi.fn(),
  syncMarketIndicators: vi.fn(),
  validateDerivedMarketRange: vi.fn(),
  runDataQualityAudit: vi.fn(),
  bumpDataRevision: vi.fn(),
  syncTradeCal: vi.fn(),
  maintainCommodityWarehouseReceipts: vi.fn(),
  dates: vi.fn(),
  state: vi.fn(),
}));
vi.mock('../runs/coordination.js', () => dependencies);
vi.mock('../runs/state.js', () => dependencies);
vi.mock('#market/calendar/sse-close.js', () => dependencies);
vi.mock('#market/calendar/read.js', () => dependencies);
vi.mock('#market/calendar/sync.js', () => dependencies);
vi.mock('#market/providers/tushare/config.js', () => ({
  loadTushareConfig: () => ({ token: 'fixture', baseUrl: 'http://invalid', minIntervalMs: 1 }),
}));
vi.mock('#market/providers/tushare/tushare-client.js', () => ({ TushareClient: class {} }));
vi.mock('#market/commodity/commodity-warehouse-receipt-maintenance.js', () => dependencies);
vi.mock('#market/state/sync.js', () => dependencies);
vi.mock('#market/state/quality.js', () => dependencies);
vi.mock('./self-heal.js', () => dependencies);
vi.mock('./daily.js', () => dependencies);
vi.mock('../publication/audit.js', () => dependencies);
vi.mock('../publication/watermark.js', () => dependencies);
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    tradeCal: { findMany: dependencies.dates },
    maintenanceState: { findUnique: dependencies.state, updateMany: vi.fn() },
  },
}));
import { runRepairMaintenance } from './repair.js';

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.finishMaintenanceRun.mockResolvedValue(undefined);
  dependencies.latestCompletedTradeDate.mockResolvedValue('20261019');
  dependencies.getRecentOpenDates.mockResolvedValue(['20261016', '20261019']);
  dependencies.dates.mockResolvedValue([{ calDate: '20261016' }, { calDate: '20261019' }]);
  dependencies.beginMaintenanceRun.mockResolvedValue({ id: 'repair', skipped: false });
  dependencies.startMaintenanceHeartbeat.mockReturnValue(async () => {});
  dependencies.selfHealMarketDates.mockResolvedValue({
    deferredDates: [],
    earliestDerivedChange: null,
  });
  dependencies.runDataQualityAudit.mockResolvedValue({ findings: [] });
  dependencies.state.mockResolvedValue({ dailyPublishedThrough: '20261020' });
});
afterEach(() => vi.unstubAllEnvs());

describe('unified repair', () => {
  it('uses twenty completed trading days by default and does not force downloads', async () => {
    await runRepairMaintenance();
    expect(dependencies.getRecentOpenDates).toHaveBeenCalledWith('20261019', 20);
    expect(dependencies.selfHealMarketDates).toHaveBeenCalledTimes(2);
    expect(dependencies.runDailyMaintenance).not.toHaveBeenCalled();
    expect(dependencies.beginMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '20261016', endDate: '20261019' }),
    );
    expect(dependencies.bumpDataRevision).toHaveBeenCalledOnce();
  });
  it('refreshes only when explicitly requested and recomputes through the existing watermark', async () => {
    await runRepairMaintenance('20261016', '20261019', true);
    expect(dependencies.runDailyMaintenance).toHaveBeenCalledTimes(2);
    expect(dependencies.selfHealMarketDates).not.toHaveBeenCalled();
    expect(dependencies.syncMarketIndicators).toHaveBeenLastCalledWith('20261016', '20261020');
  });
  it('preserves failures for retry without reporting completion', async () => {
    dependencies.selfHealMarketDates.mockResolvedValue({
      deferredDates: ['20261016'],
      earliestDerivedChange: null,
    });
    await expect(runRepairMaintenance()).rejects.toThrow('unresolved');
    expect(dependencies.finishMaintenanceRun).toHaveBeenCalledWith(
      'repair',
      'error',
      expect.anything(),
    );
    expect(dependencies.bumpDataRevision).not.toHaveBeenCalled();
  });
});
