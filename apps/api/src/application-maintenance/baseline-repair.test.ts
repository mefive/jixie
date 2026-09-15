import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfHealSummary } from './self-heal.js';

const dependencies = vi.hoisted(() => ({
  assertProductionLock: vi.fn(),
  latestCompletedTradeDate: vi.fn<() => Promise<string | null>>(),
  recentPublishedTradingDates: vi.fn(),
  selfHealMarketDates: vi.fn<() => Promise<SelfHealSummary>>(),
  syncMarketIndicators: vi.fn(),
  validateDerivedMarketRange: vi.fn(),
  loadTushareConfig: vi.fn(),
  initializeDailyWatermark: vi.fn(),
  advanceDailyWatermark: vi.fn(),
  bumpDataRevision: vi.fn(),
  beginMaintenanceRun: vi.fn(),
  recoverInterruptedMaintenanceRuns: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('./daily.js', () => ({ assertProductionLock: dependencies.assertProductionLock }));
vi.mock('#signals/runs/readiness.js', () => ({
  latestCompletedTradeDate: dependencies.latestCompletedTradeDate,
}));
vi.mock('./self-heal.js', () => ({
  recentPublishedTradingDates: dependencies.recentPublishedTradingDates,
  selfHealMarketDates: dependencies.selfHealMarketDates,
}));
vi.mock('./quality.js', () => ({
  validateDerivedMarketRange: dependencies.validateDerivedMarketRange,
}));
vi.mock('#market/sync/market-indicators.js', () => ({
  syncMarketIndicators: dependencies.syncMarketIndicators,
}));
vi.mock('#market/providers/tushare/config.js', () => ({
  loadTushareConfig: dependencies.loadTushareConfig,
}));
vi.mock('#market/providers/tushare/client.js', () => ({ TushareClient: class {} }));
vi.mock('./state.js', () => dependencies);
vi.mock('#infra/database/prisma.js', () => ({
  prisma: { $disconnect: dependencies.disconnect },
}));

import { repairBaseline } from './baseline-repair.js';

function repaired(overrides: Partial<SelfHealSummary> = {}): SelfHealSummary {
  return {
    inspectedDates: 3,
    plannedDates: 0,
    repairedDates: [],
    coreDates: [],
    moneyflowDates: [],
    indexDates: [],
    deferredDates: [],
    earliestDerivedChange: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS', '3');
  dependencies.latestCompletedTradeDate.mockResolvedValue('20260914');
  dependencies.recentPublishedTradingDates.mockResolvedValue(['20260910', '20260911', '20260914']);
  dependencies.selfHealMarketDates.mockResolvedValue(repaired());
  dependencies.loadTushareConfig.mockReturnValue({
    token: 'fixture',
    baseUrl: 'http://127.0.0.1',
    minIntervalMs: 1,
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('baseline repair without publication', () => {
  it.each([
    [undefined, '20260914'],
    ['20260930', '20260914'],
    ['20260911', '20260911'],
  ])('limits requested cutoff %s to completed data', async (targetDate, expectedCutoff) => {
    await repairBaseline(targetDate);
    expect(dependencies.recentPublishedTradingDates).toHaveBeenCalledWith(expectedCutoff, 3);
    expect(dependencies.selfHealMarketDates).toHaveBeenCalledWith(
      expect.anything(),
      ['20260910', '20260911', '20260914'],
      { maxRepairDates: 3 },
    );
  });

  it('recomputes only the affected derived range and leaves publication to daily maintenance', async () => {
    const summary = repaired({ earliestDerivedChange: '20260911', repairedDates: ['20260911'] });
    dependencies.selfHealMarketDates.mockResolvedValue(summary);
    expect(await repairBaseline()).toEqual(summary);
    expect(dependencies.syncMarketIndicators).toHaveBeenCalledWith('20260911', '20260914');
    expect(dependencies.validateDerivedMarketRange).toHaveBeenCalledWith('20260911', '20260914', [
      '20260911',
      '20260914',
    ]);
    for (const operation of [
      dependencies.initializeDailyWatermark,
      dependencies.advanceDailyWatermark,
      dependencies.bumpDataRevision,
      dependencies.beginMaintenanceRun,
      dependencies.recoverInterruptedMaintenanceRuns,
      dependencies.disconnect,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('does not recompute unchanged derived data', async () => {
    await repairBaseline();
    expect(dependencies.syncMarketIndicators).not.toHaveBeenCalled();
    expect(dependencies.validateDerivedMarketRange).not.toHaveBeenCalled();
  });

  it('fails before recomputation when repair is deferred', async () => {
    dependencies.selfHealMarketDates.mockResolvedValue(
      repaired({
        deferredDates: ['20260911'],
        earliestDerivedChange: '20260910',
      }),
    );
    await expect(repairBaseline()).rejects.toThrow('Baseline self-heal deferred 1 dates');
    expect(dependencies.syncMarketIndicators).not.toHaveBeenCalled();
  });

  it('requires the production lock before inspecting data', async () => {
    dependencies.assertProductionLock.mockImplementation(() => {
      throw new Error('lock required');
    });
    await expect(repairBaseline()).rejects.toThrow('lock required');
    expect(dependencies.latestCompletedTradeDate).not.toHaveBeenCalled();
  });

  it('rejects missing completed dates and empty calendars before creating a provider', async () => {
    dependencies.latestCompletedTradeDate.mockResolvedValueOnce(null);
    await expect(repairBaseline()).rejects.toThrow('No completed SSE trading date');
    dependencies.recentPublishedTradingDates.mockResolvedValueOnce([]);
    await expect(repairBaseline()).rejects.toThrow('No open trading dates');
    expect(dependencies.loadTushareConfig).not.toHaveBeenCalled();
  });

  it('retains the default lookback and propagates derived validation failures', async () => {
    vi.stubEnv('MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS', 'invalid');
    dependencies.selfHealMarketDates.mockResolvedValue(
      repaired({ earliestDerivedChange: '20260911' }),
    );
    dependencies.validateDerivedMarketRange.mockRejectedValue(new Error('incomplete derived data'));
    await expect(repairBaseline()).rejects.toThrow('incomplete derived data');
    expect(dependencies.recentPublishedTradingDates).toHaveBeenCalledWith('20260914', 20);
    expect(dependencies.disconnect).not.toHaveBeenCalled();
  });
});
