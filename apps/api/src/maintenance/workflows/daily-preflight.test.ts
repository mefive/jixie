import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarketSourcePendingError } from '#market/errors.js';

const mocks = vi.hoisted(() => ({
  calendar: vi.fn(),
  state: vi.fn(),
  pending: vi.fn(),
  dates: vi.fn(),
  prepare: vi.fn(),
  wait: vi.fn(),
  begin: vi.fn(),
  heal: vi.fn(),
  publish: vi.fn(),
  calendarSync: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: { tradeCal: { findFirst: mocks.calendar, findUnique: vi.fn() } },
}));
vi.mock('#market/calendar/read.js', () => ({
  getOpenDatesAfter: mocks.dates,
  getExplicitOpenDate: vi.fn(),
  getOpenDates: vi.fn(),
  getRecentOpenDates: vi.fn(),
  isNextOpenDate: vi.fn(),
}));
vi.mock('#market/calendar/sse-close.js', () => ({
  latestCompletedTradeDate: async () => '20260921',
}));
vi.mock('#market/calendar/sync.js', () => ({ syncTradeCal: mocks.calendarSync }));
vi.mock('#market/providers/tushare/config.js', () => ({
  loadTushareConfig: () => ({ token: 'fixture' }),
}));
vi.mock('#market/providers/tushare/client.js', () => ({ TushareClient: class {} }));
vi.mock('#signals/daily/sync.js', () => ({
  prepareSignalEtfMarketDate: mocks.prepare,
  syncSignalMarketData: mocks.publish,
}));
vi.mock('#signals/daily/scheduler.js', () => ({ generateDailySignals: vi.fn() }));
vi.mock('../publication/watermark.js', () => ({
  getMaintenanceState: mocks.state,
  initializeDailyWatermark: vi.fn(),
  advanceDailyWatermark: vi.fn(),
  bumpDataRevision: vi.fn(),
}));
vi.mock('../publication/gate.js', () => ({ validateRawMarketDate: vi.fn() }));
vi.mock('../runs/coordination.js', () => ({
  assertProductionLock: vi.fn(),
  waitForRunningWork: vi.fn(),
}));
vi.mock('../runs/state.js', () => ({
  getPendingDailyRun: mocks.pending,
  recordDailySourceWait: mocks.wait,
  beginMaintenanceRun: mocks.begin,
  finishMaintenanceRun: vi.fn(),
  startMaintenanceHeartbeat: vi.fn(),
  updateMaintenanceRun: vi.fn(),
}));
vi.mock('./self-heal.js', () => ({ selfHealMarketDates: mocks.heal }));

const { runDailyMaintenance } = await import('./daily.js');
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T09:00:00Z'));
  mocks.state.mockResolvedValue({ dailyPublishedThrough: '20260917', dataRevision: 1 });
  mocks.pending.mockResolvedValue(null);
  mocks.calendar.mockResolvedValue({ calDate: '20260918' });
  mocks.dates.mockResolvedValue(['20260918']);
  mocks.prepare.mockRejectedValue(new MarketSourcePendingError('ETF source pending'));
});
afterEach(() => vi.useRealTimers());

it('leaves published data and the gate untouched when ETF candidates are missing', async () => {
  await expect(runDailyMaintenance()).rejects.toThrow('ETF source pending');
  expect(mocks.wait).toHaveBeenCalledWith(
    expect.objectContaining({ startDate: '20260918', endDate: '20260918' }),
  );
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(mocks.heal).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('resumes the original cutoff even after a later scheduled date is available', async () => {
  mocks.pending.mockResolvedValue({ startDate: '20260918', endDate: '20260918', status: 'error' });
  mocks.calendar.mockResolvedValue({ calDate: '20260921' });
  await expect(runDailyMaintenance({ resumeOnly: true })).rejects.toThrow('ETF source pending');
  expect(mocks.dates).toHaveBeenCalledWith('20260917', '20260918');
  expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), '20260918');
});

it('does not run a new batch in resume-only mode', async () => {
  await expect(runDailyMaintenance({ resumeOnly: true })).resolves.toBeNull();
  expect(mocks.calendarSync).not.toHaveBeenCalled();
  expect(mocks.begin).not.toHaveBeenCalled();
});

it('does not advance an existing baseline during activation', async () => {
  await expect(runDailyMaintenance({ initializeOnly: true })).resolves.toBeNull();
  expect(mocks.pending).not.toHaveBeenCalled();
  expect(mocks.calendarSync).not.toHaveBeenCalled();
});

it('opens the normal blocking run only after the retained candidates are ready', async () => {
  mocks.prepare.mockResolvedValue({ tradeDate: '20260918' });
  mocks.begin.mockRejectedValue(new Error('stop at write boundary'));
  await expect(runDailyMaintenance()).rejects.toThrow('stop at write boundary');
  expect(mocks.begin).toHaveBeenCalledWith(
    expect.objectContaining({
      targetKey: '20260918',
      startDate: '20260918',
      endDate: '20260918',
    }),
  );
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.begin.mock.invocationCallOrder[0],
  );
});

it('does not label malformed responses as source-coverage waits', async () => {
  mocks.prepare.mockRejectedValue(new Error('duplicate source row'));
  await expect(runDailyMaintenance()).rejects.toThrow('duplicate source row');
  expect(mocks.wait).not.toHaveBeenCalled();
  expect(mocks.begin).not.toHaveBeenCalled();
});
