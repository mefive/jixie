import type { TradeDate } from '@jixie/shared';
import {
  syncCommodityContinuousReturns,
  type CommodityContinuousReturnSyncSummary,
} from '../commodity/commodity-continuous-returns.js';
import {
  syncCommodityHoldingPositions,
  type CommodityHoldingSyncSummary,
} from '../commodity/commodity-holding-positions.js';
import {
  maintainCommodityWarehouseReceipts,
  type CommodityWarehouseReceiptMaintenanceSummary,
} from '../commodity/commodity-warehouse-receipt-maintenance.js';
import { loadTushareConfig } from '../config.js';
import { prisma } from '../lib/prisma.js';
import {
  syncCrossMarketBenchmarks,
  type CrossMarketBenchmarkSyncSummary,
} from '../market/cross-market-benchmarks.js';
import { syncMarketIndicators } from '../market/sync-market-indicators.js';
import {
  ChinaBondPublicCurveClient,
  syncChinaBondCreditCurves,
} from '../rates/chinabond-credit-curves.js';
import {
  syncExternalMarketDrivers,
  type ExternalMarketSyncSummary,
} from '../rates/external-market-drivers.js';
import { generateDailySignals } from '../signals/scheduler.js';
import { latestCompletedTradeDate } from '../signals/service.js';
import { syncSignalMarketData } from '../signals/sync.js';
import {
  MAJOR_INDEX_DAILY_BASIC_CODES,
  DAILY_MAINTAINED_INDEX_CODES,
} from '../store/index-presets.js';
import {
  syncDailyCoreDate,
  syncCommodityFutureContracts,
  syncCommodityFutureDaily,
  syncIndexDaily,
  syncIndexDailyBasic,
  syncMoneyflow,
  syncSwIndexDaily,
  syncTopList,
  syncTradeCal,
} from '../store/sync.js';
import { TushareClient } from '../tushare/client.js';
import { shouldSkipScheduledClosedDay } from './daily-schedule.js';
import { validateDerivedMarketRange, validateRawMarketDate } from './quality.js';
import {
  recentPublishedTradingDates,
  selfHealMarketDates,
  type SelfHealSummary,
} from './self-heal.js';
import {
  advanceDailyWatermark,
  beginMaintenanceRun,
  bumpDataRevision,
  finishMaintenanceRun,
  getMaintenanceState,
  initializeDailyWatermark,
  startMaintenanceHeartbeat,
  type MaintenanceTrigger,
  updateMaintenanceRun,
} from './state.js';

export interface DailyMaintenanceOptions {
  targetDate?: string;
  force?: boolean;
  trigger?: MaintenanceTrigger;
  onLog?: (line: string) => void;
  maintainWarehouseReceipts?: boolean;
}

export interface DailyMaintenanceSummary {
  cutoff: string;
  startDate: string | null;
  readyThrough: string | null;
  completedDates: number;
  totalDates: number;
  dataRevision: number | null;
  selfHealing: SelfHealSummary | null;
  warehouseReceipts: CommodityWarehouseReceiptMaintenanceSummary | null;
  commodityHoldingPositions: CommodityHoldingSyncSummary | null;
  commodityContinuousReturns: CommodityContinuousReturnSyncSummary | null;
  externalMarketDrivers: ExternalMarketSyncSummary | null;
  crossMarketBenchmarks: CrossMarketBenchmarkSyncSummary | null;
  creditCurves: number | null;
  signals: { deployments: number; done: number; errors: number } | null;
}

export async function runDailyMaintenance(
  options: DailyMaintenanceOptions = {},
): Promise<DailyMaintenanceSummary> {
  assertProductionLock();
  const onLog = options.onLog ?? ((line: string) => console.log(`[maintenance:daily] ${line}`));
  const trigger = options.trigger ?? (process.env.INVOCATION_ID ? 'timer' : 'manual');
  const client = createClient();
  const today = shanghaiToday();
  let state = await getMaintenanceState();
  const calendarStart =
    options.targetDate ?? state.dailyPublishedThrough ?? previousCalendarDate(today);
  const calendarEnd = options.targetDate
    ? addCalendarDays(options.targetDate, 14)
    : addCalendarDays(today, 14);
  await syncTradeCal(client, calendarStart as TradeDate, calendarEnd as TradeDate);
  const latestAvailableCutoff = await latestCompletedTradeDate();
  const cutoff = options.targetDate ?? latestAvailableCutoff;
  if (!cutoff) {
    throw new Error('No completed SSE trading date is available');
  }
  assertDate(cutoff);
  if (options.targetDate && latestAvailableCutoff && options.targetDate > latestAvailableCutoff) {
    throw new Error(`${options.targetDate} has not completed in Asia/Shanghai`);
  }
  if (!options.targetDate && !state.dailyPublishedThrough) {
    state = await initializePublishedBaseline(client, cutoff, trigger, onLog);
  }

  const dates = options.targetDate
    ? await explicitTradingDates(cutoff)
    : await missingTradingDates(state.dailyPublishedThrough!, cutoff);

  if (!options.targetDate && trigger === 'timer') {
    const todayCalendar = await prisma.tradeCal.findUnique({
      where: { exchange_calDate: { exchange: 'SSE', calDate: today } },
      select: { isOpen: true },
    });

    // systemd understands weekdays, not SSE holidays. Exit before opening the normal daily run
    // only when the refreshed calendar explicitly marks today closed and no older trading date
    // is missing. An absent calendar row must follow the normal path instead of hiding a sync
    // issue. First-time baseline initialization, when needed, has already run above.
    if (
      shouldSkipScheduledClosedDay({
        trigger,
        pendingDates: dates.length,
        todayIsOpen: todayCalendar?.isOpen ?? null,
      })
    ) {
      onLog(`${today} is not an open SSE trading day and no catch-up is pending; skipping`);
      return {
        cutoff,
        startDate: null,
        readyThrough: state.dailyPublishedThrough,
        completedDates: 0,
        totalDates: 0,
        dataRevision: state.dataRevision,
        selfHealing: null,
        warehouseReceipts: null,
        commodityHoldingPositions: null,
        commodityContinuousReturns: null,
        externalMarketDrivers: null,
        crossMarketBenchmarks: null,
        creditCurves: null,
        signals: null,
      };
    }
  }

  if (dates.length === 0) {
    if (options.targetDate) {
      onLog(`${cutoff} is not an open trading day; no maintenance is needed`);
      return {
        cutoff,
        startDate: null,
        readyThrough: state.dailyPublishedThrough,
        completedDates: 0,
        totalDates: 0,
        dataRevision: state.dataRevision,
        selfHealing: null,
        warehouseReceipts: null,
        commodityHoldingPositions: null,
        commodityContinuousReturns: null,
        externalMarketDrivers: null,
        crossMarketBenchmarks: null,
        creditCurves: null,
        signals: null,
      };
    }
    onLog(`No data gap through ${cutoff}; retrying unfinished signals only`);
    return runSignalOnlyMaintenance(
      client,
      cutoff,
      state.dailyPublishedThrough!,
      state.dataRevision,
      trigger,
      onLog,
      options.maintainWarehouseReceipts !== false,
    );
  }

  const startDate = dates[0];
  const run = await beginMaintenanceRun({
    kind: 'daily',
    targetKey: cutoff,
    startDate,
    endDate: cutoff,
    trigger,
    force: options.force,
  });
  if (run.skipped && !options.force) {
    onLog(`Daily data run ${cutoff} is already complete; retrying unfinished signals only`);
    return runSignalOnlyMaintenance(
      client,
      cutoff,
      state.dailyPublishedThrough ?? cutoff,
      state.dataRevision,
      trigger,
      onLog,
      options.maintainWarehouseReceipts !== false,
    );
  }

  const summary: DailyMaintenanceSummary = {
    cutoff,
    startDate,
    readyThrough: null,
    completedDates: 0,
    totalDates: dates.length,
    dataRevision: null,
    selfHealing: null,
    warehouseReceipts: null,
    commodityHoldingPositions: null,
    commodityContinuousReturns: null,
    externalMarketDrivers: null,
    crossMarketBenchmarks: null,
    creditCurves: null,
    signals: null,
  };
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    await updateMaintenanceRun(run.id, 'waiting_for_jobs', summary);
    await waitForRunningWork(onLog);
    if (!options.targetDate && state.dailyPublishedThrough) {
      summary.selfHealing = await healPublishedTail(
        client,
        run.id,
        state.dailyPublishedThrough,
        onLog,
      );
      if (summary.selfHealing.repairedDates.length > 0) {
        summary.dataRevision = await bumpDataRevision();
      }
      if (summary.selfHealing.deferredDates.length > 0) {
        throw new Error(
          `Daily self-heal deferred ${summary.selfHealing.deferredDates.length} dates`,
        );
      }
    }
    if (options.maintainWarehouseReceipts !== false) {
      summary.warehouseReceipts = await refreshCommodityWarehouseReceipts(
        client,
        cutoff,
        run.id,
        summary,
        onLog,
      );
    }
    summary.commodityHoldingPositions = await refreshCommodityHoldingPositions(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.commodityContinuousReturns = await refreshCommodityContinuousReturns(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.externalMarketDrivers = await refreshExternalMarketDrivers(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.crossMarketBenchmarks = await refreshCrossMarketBenchmarks(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.creditCurves = await refreshCreditCurves(cutoff, run.id, summary, onLog);
    const completedDates: string[] = [];
    let dateFailure: Error | null = null;

    for (const tradeDate of dates) {
      try {
        await updateMaintenanceRun(run.id, 'syncing_raw', {
          ...summary,
          currentDate: tradeDate,
        });
        onLog(`Fetching validated candidates for ${tradeDate}`);
        const core = await syncDailyCoreDate(client, tradeDate as TradeDate);
        await syncMoneyflow(client, tradeDate as TradeDate, tradeDate as TradeDate, {
          refresh: true,
        });
        await syncTopList(client, tradeDate as TradeDate, tradeDate as TradeDate, {
          refresh: true,
        });

        await updateMaintenanceRun(run.id, 'syncing_indices', {
          ...summary,
          currentDate: tradeDate,
          core,
        });
        for (const indexCode of DAILY_MAINTAINED_INDEX_CODES) {
          await syncIndexDaily(client, indexCode, tradeDate as TradeDate, tradeDate as TradeDate);
        }
        await syncSwIndexDaily(client, tradeDate as TradeDate, tradeDate as TradeDate);
        await syncIndexDailyBasic(
          client,
          [...MAJOR_INDEX_DAILY_BASIC_CODES],
          tradeDate as TradeDate,
          tradeDate as TradeDate,
        );
        await syncSignalMarketData(tradeDate, onLog, {
          coreAlreadyPublished: true,
          extensionsAlreadyPublished: true,
          refresh: true,
        });

        await updateMaintenanceRun(run.id, 'validating_raw', {
          ...summary,
          currentDate: tradeDate,
          core,
        });
        const quality = await validateRawMarketDate(tradeDate);
        completedDates.push(tradeDate);
        summary.completedDates = completedDates.length;
        summary.readyThrough = tradeDate;
        await updateMaintenanceRun(run.id, 'raw_ready', {
          ...summary,
          currentDate: tradeDate,
          core,
          quality,
        });
      } catch (error) {
        dateFailure = toError(error);
        onLog(`${tradeDate} failed before derived publication: ${dateFailure.message}`);
        break;
      }
    }

    if (completedDates.length > 0) {
      const readyThrough = completedDates.at(-1)!;
      await updateMaintenanceRun(run.id, 'market_state', summary);
      onLog(`Computing market state ${startDate}..${readyThrough}`);
      await syncMarketIndicators(startDate, readyThrough);

      await updateMaintenanceRun(run.id, 'validating_derived', summary);
      const derived = await validateDerivedMarketRange(startDate, readyThrough, completedDates);
      const advancesWatermark =
        !options.targetDate ||
        (state.dailyPublishedThrough != null &&
          (await isNextTradingDate(state.dailyPublishedThrough, readyThrough)));
      summary.dataRevision = advancesWatermark
        ? await advanceDailyWatermark(readyThrough)
        : await bumpDataRevision();
      summary.readyThrough = readyThrough;
      await updateMaintenanceRun(run.id, 'published', { ...summary, derived });
    }

    if (dateFailure) {
      throw dateFailure;
    }
    if (summary.readyThrough !== cutoff) {
      throw new Error(
        `Daily maintenance reached ${summary.readyThrough ?? 'none'} but cutoff is ${cutoff}`,
      );
    }

    if (cutoff === latestAvailableCutoff) {
      await updateMaintenanceRun(run.id, 'signals', summary);
      summary.signals = await generateDailySignals(cutoff, onLog);
    }
    await finishMaintenanceRun(run.id, 'done', { summary });
    onLog(`Published ${summary.completedDates}/${summary.totalDates} dates through ${cutoff}`);
    return summary;
  } catch (error) {
    const failure = toError(error);
    await finishMaintenanceRun(run.id, 'error', { summary, error: failure.message }).catch(
      () => {},
    );
    throw failure;
  } finally {
    await stopHeartbeat();
  }
}

async function initializePublishedBaseline(
  client: TushareClient,
  cutoff: string,
  trigger: MaintenanceTrigger,
  onLog: (line: string) => void,
): Promise<Awaited<ReturnType<typeof getMaintenanceState>>> {
  const latest = await prisma.daily.findFirst({
    where: { tradeDate: { lte: cutoff } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (!latest) {
    throw new Error('Daily is empty; complete the full market-data import first');
  }

  const tradeDate = latest.tradeDate;
  const run = await beginMaintenanceRun({
    kind: 'daily',
    targetKey: `baseline:${tradeDate}`,
    startDate: tradeDate,
    endDate: tradeDate,
    trigger,
    force: true,
  });
  const summary: DailyMaintenanceSummary = {
    cutoff,
    startDate: tradeDate,
    readyThrough: null,
    completedDates: 0,
    totalDates: 0,
    dataRevision: null,
    selfHealing: null,
    warehouseReceipts: null,
    commodityHoldingPositions: null,
    commodityContinuousReturns: null,
    externalMarketDrivers: null,
    crossMarketBenchmarks: null,
    creditCurves: null,
    signals: null,
  };
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    await updateMaintenanceRun(run.id, 'waiting_for_jobs', summary);
    await waitForRunningWork(onLog);
    const lookback = positiveInteger(process.env.MAINTENANCE_BASELINE_REPAIR_LOOKBACK_DAYS, 20);
    const dates = await recentPublishedTradingDates(tradeDate, lookback);
    await updateMaintenanceRun(run.id, 'self_healing', summary);
    summary.selfHealing = await selfHealMarketDates(client, dates, {
      maxRepairDates: lookback,
      onLog,
    });
    if (summary.selfHealing.deferredDates.length > 0) {
      throw new Error(
        `Baseline self-heal deferred ${summary.selfHealing.deferredDates.length} dates`,
      );
    }

    await updateMaintenanceRun(run.id, 'validating_raw', summary);
    await validateRawMarketDate(tradeDate);
    const marketIndicator = await prisma.marketIndicator.findUnique({
      where: { tradeDate },
      select: { tradeDate: true },
    });
    const validationStart = summary.selfHealing.earliestDerivedChange ?? tradeDate;
    if (summary.selfHealing.earliestDerivedChange || !marketIndicator) {
      await updateMaintenanceRun(run.id, 'market_state', summary);
      await syncMarketIndicators(validationStart, tradeDate);
    }
    const expectedDates =
      validationStart === tradeDate
        ? [tradeDate]
        : await tradingDatesBetween(validationStart, tradeDate);
    await updateMaintenanceRun(run.id, 'validating_derived', summary);
    await validateDerivedMarketRange(validationStart, tradeDate, expectedDates);

    await initializeDailyWatermark(tradeDate);
    const state = await getMaintenanceState();
    summary.readyThrough = tradeDate;
    summary.dataRevision = state.dataRevision;
    await finishMaintenanceRun(run.id, 'done', { summary });
    onLog(`Initialized validated daily publication baseline at ${tradeDate}`);
    return state;
  } catch (error) {
    const failure = toError(error);
    await finishMaintenanceRun(run.id, 'error', { summary, error: failure.message }).catch(
      () => {},
    );
    throw failure;
  } finally {
    await stopHeartbeat();
  }
}

async function runSignalOnlyMaintenance(
  client: TushareClient,
  cutoff: string,
  publishedThrough: string,
  dataRevision: number,
  trigger: MaintenanceTrigger,
  onLog: (line: string) => void,
  maintainWarehouseReceipts: boolean,
): Promise<DailyMaintenanceSummary> {
  const run = await beginMaintenanceRun({
    kind: 'daily',
    targetKey: cutoff,
    startDate: cutoff,
    endDate: cutoff,
    trigger,
    force: true,
  });
  const summary: DailyMaintenanceSummary = {
    cutoff,
    startDate: null,
    readyThrough: cutoff,
    completedDates: 0,
    totalDates: 0,
    dataRevision,
    selfHealing: null,
    warehouseReceipts: null,
    commodityHoldingPositions: null,
    commodityContinuousReturns: null,
    externalMarketDrivers: null,
    crossMarketBenchmarks: null,
    creditCurves: null,
    signals: null,
  };
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    await updateMaintenanceRun(run.id, 'waiting_for_jobs', summary);
    await waitForRunningWork(onLog);
    summary.selfHealing = await healPublishedTail(client, run.id, publishedThrough, onLog);
    if (summary.selfHealing.repairedDates.length > 0) {
      summary.dataRevision = await bumpDataRevision();
    }
    if (summary.selfHealing.deferredDates.length > 0) {
      throw new Error(`Daily self-heal deferred ${summary.selfHealing.deferredDates.length} dates`);
    }
    if (maintainWarehouseReceipts) {
      summary.warehouseReceipts = await refreshCommodityWarehouseReceipts(
        client,
        cutoff,
        run.id,
        summary,
        onLog,
      );
    }
    summary.commodityHoldingPositions = await refreshCommodityHoldingPositions(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.commodityContinuousReturns = await refreshCommodityContinuousReturns(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.externalMarketDrivers = await refreshExternalMarketDrivers(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.crossMarketBenchmarks = await refreshCrossMarketBenchmarks(
      client,
      cutoff,
      run.id,
      summary,
      onLog,
    );
    summary.creditCurves = await refreshCreditCurves(cutoff, run.id, summary, onLog);
    await updateMaintenanceRun(run.id, 'signals', summary);
    summary.signals = await generateDailySignals(cutoff, onLog);
    await finishMaintenanceRun(run.id, 'done', { summary });
    return summary;
  } catch (error) {
    const failure = toError(error);
    await finishMaintenanceRun(run.id, 'error', { summary, error: failure.message }).catch(
      () => {},
    );
    throw failure;
  } finally {
    await stopHeartbeat();
  }
}

async function refreshExternalMarketDrivers(
  client: TushareClient,
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<ExternalMarketSyncSummary> {
  await updateMaintenanceRun(runId, 'external_market_drivers', summary);
  return syncExternalMarketDrivers(client, addCalendarDays(cutoff, -14), cutoff, onLog);
}

async function refreshCrossMarketBenchmarks(
  client: TushareClient,
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<CrossMarketBenchmarkSyncSummary> {
  await updateMaintenanceRun(runId, 'cross_market_benchmarks', summary);
  return syncCrossMarketBenchmarks(client, addCalendarDays(cutoff, -14), cutoff, onLog);
}

async function refreshCreditCurves(
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<number> {
  await updateMaintenanceRun(runId, 'credit_curves', summary);
  return syncChinaBondCreditCurves(
    new ChinaBondPublicCurveClient(),
    addCalendarDays(cutoff, -21),
    cutoff,
    onLog,
  );
}

async function refreshCommodityWarehouseReceipts(
  client: TushareClient,
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<CommodityWarehouseReceiptMaintenanceSummary> {
  await updateMaintenanceRun(runId, 'commodity_warehouse_receipts', summary);
  return maintainCommodityWarehouseReceipts(client, cutoff as TradeDate, prisma, onLog, {
    lookbackTradingDays: positiveInteger(
      process.env.MAINTENANCE_WAREHOUSE_RECEIPT_LOOKBACK_DAYS,
      20,
    ),
    maximumLagTradingDays: nonNegativeInteger(
      process.env.MAINTENANCE_WAREHOUSE_RECEIPT_MAX_LAG_DAYS,
      3,
    ),
  });
}

async function refreshCommodityHoldingPositions(
  client: TushareClient,
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<CommodityHoldingSyncSummary> {
  await updateMaintenanceRun(runId, 'commodity_holding_positions', summary);
  const startDate = addCalendarDays(cutoff, -45);
  await syncCommodityFutureContracts(client);
  await syncCommodityFutureDaily(client, startDate as TradeDate, cutoff as TradeDate);
  return syncCommodityHoldingPositions(client, startDate, cutoff, prisma, onLog);
}

async function refreshCommodityContinuousReturns(
  client: TushareClient,
  cutoff: string,
  runId: string,
  summary: DailyMaintenanceSummary,
  onLog: (line: string) => void,
): Promise<CommodityContinuousReturnSyncSummary> {
  await updateMaintenanceRun(runId, 'commodity_continuous_returns', summary);
  return syncCommodityContinuousReturns(
    client,
    addCalendarDays(cutoff, -45),
    cutoff,
    prisma,
    onLog,
  );
}

async function healPublishedTail(
  client: TushareClient,
  runId: string,
  publishedThrough: string,
  onLog: (line: string) => void,
): Promise<SelfHealSummary> {
  const lookback = positiveInteger(process.env.MAINTENANCE_DAILY_REPAIR_LOOKBACK_DAYS, 5);
  const dates = await recentPublishedTradingDates(publishedThrough, lookback);
  await updateMaintenanceRun(runId, 'self_healing', {
    publishedThrough,
    inspectedDates: dates.length,
  });
  const repaired = await selfHealMarketDates(client, dates, {
    maxRepairDates: lookback,
    onLog,
  });
  await validateRawMarketDate(publishedThrough);
  if (repaired.earliestDerivedChange) {
    await updateMaintenanceRun(runId, 'market_state', repaired);
    await syncMarketIndicators(repaired.earliestDerivedChange, publishedThrough);
    const expectedDates = await tradingDatesBetween(
      repaired.earliestDerivedChange,
      publishedThrough,
    );
    await updateMaintenanceRun(runId, 'validating_derived', repaired);
    await validateDerivedMarketRange(
      repaired.earliestDerivedChange,
      publishedThrough,
      expectedDates,
    );
  }
  return repaired;
}

async function missingTradingDates(watermark: string, cutoff: string): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gt: watermark, lte: cutoff },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return rows.map((row) => row.calDate);
}

async function explicitTradingDates(tradeDate: string): Promise<string[]> {
  const row = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
    select: { isOpen: true },
  });
  if (!row || row.isOpen !== 1) {
    return [];
  }
  return [tradeDate];
}

async function tradingDatesBetween(startDate: string, endDate: string): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: startDate, lte: endDate },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return rows.map((row) => row.calDate);
}

async function isNextTradingDate(watermark: string, tradeDate: string): Promise<boolean> {
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: watermark } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next?.calDate === tradeDate;
}

export async function waitForRunningWork(onLog: (line: string) => void): Promise<void> {
  const timeoutMilliseconds = Number(process.env.MAINTENANCE_JOB_DRAIN_TIMEOUT_MS ?? 120_000);
  const quietMilliseconds = Number(process.env.MAINTENANCE_JOB_QUIET_MS ?? 5_000);
  const deadline = Date.now() + timeoutMilliseconds;
  let quietSince: number | null = null;

  for (;;) {
    const [jobs, agentTurns, factorWeatherRuns] = await Promise.all([
      prisma.job.count({ where: { status: { in: ['queued', 'running'] } } }),
      prisma.agentTurn.count({ where: { status: 'running' } }),
      prisma.factorWeatherPin.count({ where: { status: 'running' } }),
    ]);
    if (jobs + agentTurns + factorWeatherRuns === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMilliseconds) {
        return;
      }
    } else {
      quietSince = null;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${jobs} background jobs, ${agentTurns} Agent turns, and ${factorWeatherRuns} factor weather runs`,
      );
    }
    if (jobs + agentTurns + factorWeatherRuns > 0) {
      onLog(
        `Waiting for ${jobs} background jobs, ${agentTurns} Agent turns, and ${factorWeatherRuns} factor weather runs`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function createClient(): TushareClient {
  const config = loadTushareConfig();
  return new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
}

function addCalendarDays(date: string, days: number): string {
  const parsed = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return parsed.toISOString().slice(0, 10).replaceAll('-', '');
}

function previousCalendarDate(date: string): string {
  return addCalendarDays(date, -1);
}

function assertDate(date: string): void {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`Invalid maintenance date ${date}; expected YYYYMMDD`);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function assertProductionLock(): void {
  if (process.env.NODE_ENV === 'production' && process.env.JIXIE_MAINTENANCE_LOCK_HELD !== '1') {
    throw new Error('Production maintenance must run through the flock-protected systemd service');
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
