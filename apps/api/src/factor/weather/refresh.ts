import { datasetInputReadiness, marketRevision } from '#market/synchronization/readiness.js';
import {
  withRetainedMarketAccess,
  acquireWorkOwner,
  MarketAccessBusyError,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import { factorAnalysisWorkerInputSchema } from '../analysis/worker-input.js';
import { runWorker } from '#jobs/worker.js';
import { factorAnalysisWorkerMessageSchema } from '../analysis/worker-protocol.js';
import { Worker } from 'node:worker_threads';
import type { FactorReport, FactorWeatherPoint } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import { createDefaultFactorAnalysisSpecV3 } from '../analysis/spec.js';
import { canonicalJson, sha256 } from '../sources/fingerprint.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('../analysis/worker.boot.mjs', import.meta.url)
  : new URL('../analysis/worker.js', import.meta.url);

const HISTORY_START = '20150101';
const standardSpecTemplate = createDefaultFactorAnalysisSpecV3({
  freq: 'month',
  start: '00000000',
  end: '00000000',
  neutral: 'size_industry',
});
const { start: _start, end: _end, ...standardAnalysisSpec } = standardSpecTemplate;
const STANDARD_METHODOLOGY = {
  version: 1,
  analysis: standardAnalysisSpec,
  weighting: 'equal',
  groups: 10,
  partialMonth: false,
} as const;

export const FACTOR_WEATHER_METHODOLOGY_HASH = sha256(canonicalJson(STANDARD_METHODOLOGY));

const activeRefreshes = new Map<string, Promise<FactorWeatherRefreshResult>>();

/**
 * 汇总气象刷新成功、失败与更新范围，供调度和状态展示。
 *
 * Summarize weather refresh outcomes and updated ranges for scheduling and display.
 */
export interface FactorWeatherRefreshResult {
  pinId: string;
  computedThrough: string | null;
  pointsWritten: number;
  skipped: boolean;
}

export function factorWeatherMethodology() {
  return {
    frequency: STANDARD_METHODOLOGY.analysis.freq,
    neutral: STANDARD_METHODOLOGY.analysis.neutral,
    weighting: STANDARD_METHODOLOGY.weighting,
    groups: STANDARD_METHODOLOGY.groups,
    partialMonth: STANDARD_METHODOLOGY.partialMonth,
  };
}

export function refreshFactorWeatherPin(
  pinId: string,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<FactorWeatherRefreshResult> {
  const active = activeRefreshes.get(pinId);
  if (active) {
    return active;
  }

  const refresh = withRetainedMarketAccess(async () => {
    const owner = await acquireWorkOwner('weather', pinId);
    try {
      return await performRefresh(pinId, options);
    } finally {
      await owner.release();
    }
  }).finally(() => activeRefreshes.delete(pinId));
  activeRefreshes.set(pinId, refresh);
  return refresh;
}

/**
 * 启动时将旧进程遗留 running 刷新状态恢复为可重试状态。
 *
 * On API boot, reset only work without a live cross-process owner.
 */
export async function resetInterruptedFactorWeatherRefreshes(): Promise<number> {
  const pins = await getDatabase().factorWeatherPin.findMany({
    where: { status: 'running' },
    select: { id: true },
  });
  let count = 0;
  for (const pin of pins) {
    let owner: MarketLock;
    try {
      owner = await acquireWorkOwner('weather', pin.id);
    } catch (error) {
      if (error instanceof MarketAccessBusyError) {
        continue;
      }
      throw error;
    }
    try {
      const result = await getDatabase().factorWeatherPin.updateMany({
        where: { id: pin.id, status: 'running' },
        data: { status: 'pending', error: null },
      });
      count += result.count;
    } finally {
      await owner.release();
    }
  }
  return count;
}

/**
 * 依次刷新所有符合条件的因子气象固定项，汇总结果。
 *
 * Refresh eligible factor-weather pins and collect outcomes.
 */
export async function refreshAllFactorWeatherPins(
  options: {
    onLog?: (line: string) => void;
    strict?: boolean;
  } = {},
): Promise<FactorWeatherRefreshResult[]> {
  const pins = await getDatabase().factorWeatherPin.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, factorName: true },
  });
  const results: FactorWeatherRefreshResult[] = [];

  for (const [index, pin] of pins.entries()) {
    options.onLog?.(`Factor weather ${index + 1}/${pins.length}: ${pin.factorName}`);
    try {
      results.push(await refreshFactorWeatherPin(pin.id));
    } catch (error) {
      if (options.strict) {
        throw error;
      }
      options.onLog?.(
        `Factor weather failed for ${pin.factorName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return results;
}

/**
 * 确定增量区间、执行气象计算并持久化结果与刷新状态。
 *
 * Resolve the incremental interval, compute weather and persist output and refresh state.
 */
async function performRefresh(
  pinId: string,
  options: { force?: boolean; signal?: AbortSignal },
): Promise<FactorWeatherRefreshResult> {
  const pin = await getDatabase().factorWeatherPin.findUnique({ where: { id: pinId } });
  if (!pin) {
    return { pinId, computedThrough: null, pointsWritten: 0, skipped: true };
  }

  const inputRevision = await marketRevision();
  const methodologyHash = FACTOR_WEATHER_METHODOLOGY_HASH;
  const completedThrough = await latestCompletedMonthEnd();
  if (!completedThrough) {
    await getDatabase().factorWeatherPin.update({
      where: { id: pinId },
      data: { status: 'pending', error: null },
    });
    return { pinId, computedThrough: null, pointsWritten: 0, skipped: true };
  }
  const requiresFullRefresh =
    Boolean(options.force) || !pin.computedThrough || pin.methodologyHash !== methodologyHash;
  if (
    !requiresFullRefresh &&
    !pin.dirtyFrom &&
    pin.status === 'ready' &&
    pin.computedThrough === completedThrough
  ) {
    await getDatabase().factorWeatherPin.update({
      where: { id: pinId },
      data: { updatedAt: new Date() },
    });

    return { pinId, computedThrough: completedThrough, pointsWritten: 0, skipped: true };
  }

  await getDatabase().factorWeatherPin.update({
    where: { id: pinId },
    data: { status: 'running', error: null },
  });

  try {
    const start = requiresFullRefresh
      ? await weatherHistoryStart(completedThrough)
      : await incrementalStart(
          pin.dirtyFrom && pin.dirtyFrom < pin.computedThrough!
            ? pin.dirtyFrom
            : pin.computedThrough!,
        );
    const spec = createDefaultFactorAnalysisSpecV3({
      freq: 'month',
      start,
      end: completedThrough,
      neutral: 'size_industry',
    });
    const report = await runWeatherWorker(
      pin.factorId,
      pin.factorName,
      pin.factorCode,
      pin.language === 'python' ? 'python' : 'typescript',
      pin.runtimeVersion,
      spec,
      options.signal,
    );
    const observations = report.periodObservations ?? [];
    const newObservations = requiresFullRefresh
      ? observations
      : observations.filter((observation) =>
          pin.dirtyFrom
            ? observation.periodEndDate >= pin.dirtyFrom
            : observation.periodEndDate > pin.computedThrough!,
        );
    const data = newObservations.map((observation) => ({
      pinId,
      formationDate: observation.formationDate,
      periodEndDate: observation.periodEndDate,
      rankIc: observation.rankIc,
      topReturn: observation.topReturn,
      bottomReturn: observation.bottomReturn,
      longShortGrossReturn: observation.longShortGrossReturn,
      longShortNetReturn: observation.longShortNetReturn,
      topTurnover: observation.topTurnover,
      sampleSize: observation.sampleSize,
      sampleCoverage: observation.sampleCoverage,
    }));

    await getDatabase().$transaction(async (transaction) => {
      const currentRevision = await transaction.marketDataState.findUnique({
        where: { key: 'global' },
      });
      if ((currentRevision?.revision ?? 0) !== inputRevision) {
        throw new Error('Stale factor-weather input revision');
      }
      if (requiresFullRefresh) {
        await transaction.factorWeatherPoint.deleteMany({ where: { pinId } });
      } else {
        await transaction.factorWeatherPoint.deleteMany({
          where: {
            pinId,
            periodEndDate: pin.dirtyFrom ? { gte: pin.dirtyFrom } : { gt: pin.computedThrough! },
          },
        });
      }
      if (data.length > 0) {
        await transaction.factorWeatherPoint.createMany({ data });
      }
      await transaction.factorWeatherPin.update({
        where: { id: pinId },
        data: {
          status: 'ready',
          error: null,
          computedThrough: completedThrough,
          methodologyHash,
          dirtyFrom: null,
          inputRevision,
        },
      });
    });

    return { pinId, computedThrough: completedThrough, pointsWritten: data.length, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getDatabase().factorWeatherPin.updateMany({
      where: { id: pinId },
      data: { status: 'error', error: message },
    });
    throw error;
  }
}

/**
 * 解析最近已完成月末，避免将未完成月纳入气象分析。
 *
 * Resolve the latest completed month end for weather analysis.
 */
async function latestCompletedMonthEnd(): Promise<string | null> {
  const currentMonthStart = shanghaiToday().slice(0, 6) + '01';
  const candidates = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lt: currentMonthStart } },
    orderBy: { calDate: 'desc' },
    take: 260,
    select: { calDate: true },
  });
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const month = candidate.calDate.slice(0, 6);
    if (seen.has(month)) {
      continue;
    }
    seen.add(month);
    const readiness = await datasetInputReadiness(
      ['stock-prices', 'stock-adjustments', 'stock-valuations'].map((dataset) => ({
        dataset,
        scope: 'all',
        startDate: `${month}01`,
        endDate: candidate.calDate,
      })),
    );
    if (readiness.ready) {
      return candidate.calDate;
    }
  }

  return null;
}

async function weatherHistoryStart(end: string): Promise<string> {
  const firstDaily = await getDatabase().daily.findFirst({
    where: { tradeDate: { gte: HISTORY_START, lte: end } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true },
  });
  if (!firstDaily) {
    throw new Error('No market history is available for factor weather.');
  }
  return firstDaily.tradeDate;
}

/**
 * 根据已有结果和回看需求确定增量重算起点。
 *
 * Resolve the incremental recalculation start from stored results and lookback needs.
 */
async function incrementalStart(computedThrough: string): Promise<string> {
  const rows = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { lte: computedThrough } },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  });
  const monthEnds: string[] = [];
  const seenMonths = new Set<string>();
  for (const row of rows) {
    const month = row.calDate.slice(0, 6);
    if (!seenMonths.has(month)) {
      seenMonths.add(month);
      monthEnds.push(row.calDate);
    }
    if (monthEnds.length === 2) {
      return monthEnds[1];
    }
  }
  return weatherHistoryStart(computedThrough);
}

/**
 * 在 Worker 执行气象计算，并管理日志、取消与退出清理。
 *
 * Compute weather in a worker with log forwarding, cancellation and exit cleanup.
 */
async function runWeatherWorker(
  factor: string,
  label: string,
  code: string,
  language: 'typescript' | 'python',
  runtimeVersion: string,
  spec: ReturnType<typeof createDefaultFactorAnalysisSpecV3>,
  signal?: AbortSignal,
): Promise<FactorReport> {
  const payload = await runWorker({
    signal,
    start: () =>
      new Worker(workerUrl, {
        workerData: factorAnalysisWorkerInputSchema.parse({
          reportId: `weather:${factor}`,
          factor,
          source: { kind: 'single', code, label, language, runtimeVersion },
          spec,
          locale: 'zh',
        }),
      }),
    onLog: () => {},
    readMessage: (raw) => factorAnalysisWorkerMessageSchema.parse(raw),
    exitedMessage: (code) => `Factor weather worker exited with code ${code} without a result.`,
  });
  return JSON.parse(payload) as FactorReport;
}

export function toFactorWeatherPoint(row: {
  formationDate: string;
  periodEndDate: string;
  rankIc: number;
  topReturn: number;
  bottomReturn: number;
  longShortGrossReturn: number;
  longShortNetReturn: number;
  topTurnover: number | null;
  sampleSize: number;
  sampleCoverage: number;
}): FactorWeatherPoint {
  return { ...row };
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
