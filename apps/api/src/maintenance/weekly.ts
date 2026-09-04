import type { TradeDate } from '@jixie/shared';
import { loadTushareConfig } from '../config.js';
import { runDataQualityAudit } from '../data-quality/audit.js';
import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import { syncChinaMacroData } from '../macro/china-macro.js';
import { BlsPublicDataClient, syncUsHeadlineCpiData } from '../macro/us-headline-cpi.js';
import { syncMarketIndicators } from '../market/sync-market-indicators.js';
import {
  MinistryOfFinanceCurveClient,
  syncChinaTreasuryYieldCurve,
} from '../rates/china-treasury-curve.js';
import { refreshAllFactorWeatherPins } from '../factor/weather.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../store/index-presets.js';
import { refreshEtfRegistryRevisions } from '../store/etf-market-sync.js';
import { ETF_RESEARCH_CODES } from '../store/etf-research-registry.js';
import {
  syncEtfBasic,
  syncFutureContracts,
  syncIndexWeight,
  syncIndexBenchmarks,
  syncStockBasic,
  syncStockNameHistory,
  syncSwIndustry,
  stockCodesWithDailyData,
  type ReferenceSyncSummary,
} from '../store/sync.js';
import { TushareClient } from '../tushare/client.js';
import { canonicalizeStockCodes } from './canonicalize-stock-codes.js';
import { assertProductionLock, waitForRunningWork } from './daily.js';
import { validateDerivedMarketRange } from './quality.js';
import {
  recentPublishedTradingDates,
  selfHealMarketDates,
  type SelfHealSummary,
} from './self-heal.js';
import {
  advanceWeeklyWatermark,
  beginMaintenanceRun,
  completedMaintenanceItems,
  finishMaintenanceRun,
  getMaintenanceState,
  startMaintenanceHeartbeat,
  type MaintenanceTrigger,
  updateMaintenanceRun,
} from './state.js';
import { financialHistoryStart, quarterlyReportPeriods } from './reference-periods.js';
import {
  addReferenceSyncSummary,
  chunkReferenceCodes,
  emptyReferenceSyncSummary,
  runReferenceWorkerProcess,
} from './reference-worker-process.js';
import type { ReferenceWorkerStage } from './reference-worker.js';

export interface WeeklyMaintenanceSummary {
  date: string;
  auditStart: string;
  auditErrors: number;
  auditWarnings: number;
  canonicalizedRows: number;
  earliestMarketChange: string | null;
  selfHealing: SelfHealSummary | null;
  financialStatements: WeeklyReferenceSyncSummary | null;
  financials: WeeklyReferenceSyncSummary | null;
  dividends: WeeklyReferenceSyncSummary | null;
  chinaTreasuryCurve: number | null;
  factorWeatherPoints: number;
  etfRevisionDates: number;
  earliestEtfChange: string | null;
  dataRevision: number | null;
}

interface WeeklyReferenceSyncSummary extends ReferenceSyncSummary {
  planned: number;
  resumed: number;
}

// Cross-market holidays remove some SSE sessions from the complete risk-driver sample. Keep a
// small calendar buffer while still requiring the quality gate's 252 complete observations.
const WEEKLY_AUDIT_TRADING_DAYS = 270;

export async function runWeeklyMaintenance(
  options: {
    force?: boolean;
    trigger?: MaintenanceTrigger;
    onLog?: (line: string) => void;
  } = {},
): Promise<WeeklyMaintenanceSummary> {
  assertProductionLock();
  const onLog = options.onLog ?? ((line: string) => console.log(`[maintenance:weekly] ${line}`));
  const today = shanghaiToday();
  const trigger = options.trigger ?? (process.env.INVOCATION_ID ? 'timer' : 'manual');
  const latestWeekly = await prisma.maintenanceRun.findFirst({
    where: { kind: 'weekly' },
    orderBy: { startedAt: 'desc' },
    select: { status: true, targetKey: true },
  });
  const targetKey = selectWeeklyTargetKey(today, latestWeekly);
  const run = await beginMaintenanceRun({
    kind: 'weekly',
    targetKey,
    startDate: today,
    endDate: today,
    trigger,
    force: options.force,
  });
  const auditStart = await rollingAuditStart(today);
  const summary: WeeklyMaintenanceSummary = {
    date: today,
    auditStart,
    auditErrors: 0,
    auditWarnings: 0,
    canonicalizedRows: 0,
    earliestMarketChange: null,
    selfHealing: null,
    financialStatements: null,
    financials: null,
    dividends: null,
    chinaTreasuryCurve: null,
    factorWeatherPoints: 0,
    etfRevisionDates: 0,
    earliestEtfChange: null,
    dataRevision: null,
  };
  if (run.skipped && !options.force) {
    onLog(`Weekly run ${targetKey} is already complete`);
    return summary;
  }
  const stopHeartbeat = startMaintenanceHeartbeat(run.id);

  try {
    await updateMaintenanceRun(run.id, 'waiting_for_jobs', summary);
    await waitForRunningWork(onLog);
    const standardClient = createClient();
    const weightStart = addMonths(today, -6);
    const state = await getMaintenanceState();

    await updateMaintenanceRun(run.id, 'stock_reference', summary);
    await syncStockBasic(standardClient);
    await syncStockNameHistory(standardClient, '19900101' as TradeDate, today as TradeDate);

    const allCodes = await stockCodesWithDailyData();
    const earliestMarketRow = await prisma.daily.findFirst({
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    });
    if (!earliestMarketRow) {
      throw new Error('Daily is empty; complete the full market-data import first');
    }
    const financialPeriods = quarterlyReportPeriods(
      financialHistoryStart(earliestMarketRow.tradeDate),
      today,
    );
    onLog(
      `Full reference reconciliation: ${financialPeriods.length} statement and indicator periods via VIP, ${allCodes.length} dividend stocks`,
    );

    await updateMaintenanceRun(run.id, 'financial_statements', summary);
    summary.financialStatements = await runReferenceStage(
      run.id,
      'financial_statements',
      financialPeriods,
      positiveInteger(process.env.MAINTENANCE_WEEKLY_FINANCIAL_STATEMENT_PERIODS_PER_PROCESS, 1),
      onLog,
    );
    await checkpointSqliteWal();

    await updateMaintenanceRun(run.id, 'financials', summary);
    summary.financials = await runReferenceStage(
      run.id,
      'financials',
      financialPeriods,
      positiveInteger(process.env.MAINTENANCE_WEEKLY_FINANCIAL_PERIODS_PER_PROCESS, 1),
      onLog,
    );
    await checkpointSqliteWal();

    await updateMaintenanceRun(run.id, 'dividends', summary);
    summary.dividends = await runReferenceStage(
      run.id,
      'dividends',
      allCodes,
      positiveInteger(process.env.MAINTENANCE_WEEKLY_DIVIDEND_CODES_PER_PROCESS, 200),
      onLog,
    );
    await checkpointSqliteWal();

    const indexBefore = await prisma.indexWeight.findMany({
      where: {
        indexCode: { in: MARKET_WEATHER_INDICATOR_INDEX_CODES },
        tradeDate: { gte: weightStart, lte: today },
      },
      orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }, { conCode: 'asc' }],
    });
    await updateMaintenanceRun(run.id, 'index_membership', summary);
    for (const indexCode of MARKET_WEATHER_INDICATOR_INDEX_CODES) {
      await syncIndexWeight(
        standardClient,
        indexCode,
        weightStart as TradeDate,
        today as TradeDate,
      );
    }
    const indexAfter = await prisma.indexWeight.findMany({
      where: {
        indexCode: { in: MARKET_WEATHER_INDICATOR_INDEX_CODES },
        tradeDate: { gte: weightStart, lte: today },
      },
      orderBy: [{ indexCode: 'asc' }, { tradeDate: 'asc' }, { conCode: 'asc' }],
    });
    const indexChangedAt = earliestChangedDate(
      indexBefore,
      indexAfter,
      (row) => `${row.indexCode}|${row.conCode}|${row.tradeDate}`,
      (row) => row.tradeDate,
    );

    const industryBefore = await prisma.swIndustryMember.findMany({
      orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
    });
    await updateMaintenanceRun(run.id, 'industry_membership', summary);
    await syncSwIndustry(standardClient);
    const industryAfter = await prisma.swIndustryMember.findMany({
      orderBy: [{ tsCode: 'asc' }, { l1Code: 'asc' }, { inDate: 'asc' }],
    });
    const industryChangedAt = earliestChangedDate(
      industryBefore,
      industryAfter,
      (row) => `${row.tsCode}|${row.l1Code}|${row.inDate}`,
      (row) => row.inDate,
    );

    await updateMaintenanceRun(run.id, 'metadata', summary);
    await syncIndexBenchmarks(standardClient);
    await syncEtfBasic(standardClient);
    await syncFutureContracts(standardClient);
    await syncChinaMacroData(
      standardClient,
      addMonths(today, -6).slice(0, 6),
      today.slice(0, 6),
      onLog,
    );
    await syncUsHeadlineCpiData(
      new BlsPublicDataClient(),
      addMonths(today, -18).slice(0, 6),
      today.slice(0, 6),
      onLog,
    );
    await updateMaintenanceRun(run.id, 'china_treasury_curve', summary);
    summary.chinaTreasuryCurve = await syncChinaTreasuryYieldCurve(
      new MinistryOfFinanceCurveClient(),
      addDays(today, -400),
      today,
      onLog,
    );

    if (state.dailyPublishedThrough) {
      const etfLookback = positiveInteger(
        process.env.MAINTENANCE_WEEKLY_ETF_REVISION_LOOKBACK_DAYS,
        252,
      );
      const etfRevisionDates = await recentPublishedTradingDates(
        state.dailyPublishedThrough,
        etfLookback,
      );
      await updateMaintenanceRun(run.id, 'etf_revisions', summary);
      const etfRevisions = await refreshEtfRegistryRevisions(
        standardClient,
        etfRevisionDates as TradeDate[],
        ETF_RESEARCH_CODES,
      );
      summary.etfRevisionDates = etfRevisions.dates;
      summary.earliestEtfChange = etfRevisions.earliestChangedDate;
    }

    await updateMaintenanceRun(run.id, 'canonicalizing_codes', summary);
    const canonicalization = await canonicalizeStockCodes();
    summary.canonicalizedRows = canonicalization.migrated;
    summary.earliestMarketChange = minimumDate([
      indexChangedAt,
      industryChangedAt,
      canonicalization.earliestMarketDate,
    ]);

    if (state.dailyPublishedThrough) {
      const lookback = positiveInteger(process.env.MAINTENANCE_WEEKLY_REPAIR_LOOKBACK_DAYS, 252);
      const repairDates = await recentPublishedTradingDates(state.dailyPublishedThrough, lookback);
      await updateMaintenanceRun(run.id, 'self_healing', summary);
      summary.selfHealing = await selfHealMarketDates(standardClient, repairDates, {
        maxRepairDates: positiveInteger(process.env.MAINTENANCE_MAX_AUTO_REPAIR_DATES, 20),
        onLog,
      });
      summary.earliestMarketChange = minimumDate([
        summary.earliestMarketChange,
        summary.selfHealing.earliestDerivedChange,
      ]);
      if (summary.selfHealing.deferredDates.length > 0) {
        throw new Error(
          `Weekly self-heal repaired ${summary.selfHealing.repairedDates.length} dates and deferred ${summary.selfHealing.deferredDates.length}; retry maintenance`,
        );
      }
    }

    await updateMaintenanceRun(run.id, 'auditing', summary);
    const audit = await runDataQualityAudit(prisma, {
      startDate: auditStart,
      endDate: today,
      windowTradingDays: 60,
      evaluationPoints: 3,
    });
    summary.auditErrors = audit.findings.filter((finding) => finding.status === 'error').length;
    summary.auditWarnings = audit.findings.filter((finding) => finding.status === 'warn').length;
    if (summary.auditErrors > 0) {
      const names = audit.findings
        .filter((finding) => finding.status === 'error')
        .map((finding) => finding.title)
        .join(', ');
      throw new Error(`Weekly data audit found ${summary.auditErrors} errors: ${names}`);
    }

    if (
      summary.earliestMarketChange &&
      state.dailyPublishedThrough &&
      summary.earliestMarketChange <= state.dailyPublishedThrough
    ) {
      await updateMaintenanceRun(run.id, 'market_state', summary);
      await syncMarketIndicators(summary.earliestMarketChange, state.dailyPublishedThrough);
      await validateDerivedMarketRange(state.dailyPublishedThrough, state.dailyPublishedThrough, [
        state.dailyPublishedThrough,
      ]);
    }

    await updateMaintenanceRun(run.id, 'factor_weather', summary);
    const factorWeather = await refreshAllFactorWeatherPins({ onLog });
    summary.factorWeatherPoints = factorWeather.reduce(
      (total, result) => total + result.pointsWritten,
      0,
    );

    summary.dataRevision = await advanceWeeklyWatermark(today);
    await finishMaintenanceRun(run.id, 'done', { summary });
    onLog(
      `Weekly maintenance complete; audit ${summary.auditErrors} errors / ${summary.auditWarnings} warnings`,
    );
    return summary;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await finishMaintenanceRun(run.id, 'error', { summary, error: failure.message }).catch(
      () => {},
    );
    throw failure;
  } finally {
    await stopHeartbeat();
  }
}

function createClient(minimumInterval = 0): TushareClient {
  const config = loadTushareConfig();
  return new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: Math.max(config.minIntervalMs, minimumInterval),
  });
}

async function runReferenceStage(
  runId: string,
  stage: ReferenceWorkerStage,
  plannedItems: string[],
  chunkSize: number,
  onLog: (line: string) => void,
): Promise<WeeklyReferenceSyncSummary> {
  const completed = await completedMaintenanceItems(runId, stage);
  const remaining = plannedItems.filter((item) => !completed.has(item));
  const chunks = chunkReferenceCodes(remaining, chunkSize);
  let result = emptyReferenceSyncSummary();

  for (const [index, items] of chunks.entries()) {
    onLog(
      `${stage} worker batch ${index + 1}/${chunks.length}: ${items.length} items (process-isolated)`,
    );
    const current = await runReferenceWorkerProcess(stage, runId, items);
    result = addReferenceSyncSummary(result, current);
    await checkpointSqliteWal();
  }

  return {
    ...result,
    planned: plannedItems.length,
    resumed: plannedItems.length - remaining.length,
  };
}

async function checkpointSqliteWal(): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(PASSIVE);');
}

async function rollingAuditStart(endDate: string): Promise<string> {
  const rows = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: endDate } },
    orderBy: { calDate: 'desc' },
    take: WEEKLY_AUDIT_TRADING_DAYS,
    select: { calDate: true },
  });
  return rows.at(-1)?.calDate ?? endDate;
}

function earliestChangedDate<Row>(
  before: Row[],
  after: Row[],
  keyOf: (row: Row) => string,
  dateOf: (row: Row) => string,
): string | null {
  const beforeByKey = new Map(before.map((row) => [keyOf(row), JSON.stringify(row)]));
  const afterByKey = new Map(after.map((row) => [keyOf(row), JSON.stringify(row)]));
  const rowByKey = new Map([...before, ...after].map((row) => [keyOf(row), row]));
  const changedDates: string[] = [];
  for (const [key, row] of rowByKey) {
    if (beforeByKey.get(key) !== afterByKey.get(key)) {
      changedDates.push(dateOf(row));
    }
  }
  return changedDates.sort()[0] ?? null;
}

function minimumDate(dates: Array<string | null>): string | null {
  return dates.filter((date): date is string => date != null).sort()[0] ?? null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function addMonths(date: string, months: number): string {
  const parsed = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1 + months, 1),
  );
  return parsed.toISOString().slice(0, 10).replaceAll('-', '');
}

function isoWeekKey(date: string): string {
  const parsed = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((parsed.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function selectWeeklyTargetKey(
  today: string,
  latestWeekly: { status: string; targetKey: string } | null,
): string {
  return latestWeekly?.status === 'error' ? latestWeekly.targetKey : isoWeekKey(today);
}
