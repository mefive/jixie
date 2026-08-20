import { Worker } from 'node:worker_threads';
import type { FactorReport, FactorWeatherPoint } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { createDefaultFactorAnalysisSpecV3, canonicalJson, sha256 } from './report-spec.js';

const workerUrl = import.meta.url.endsWith('.ts')
  ? new URL('./factor-worker.boot.mjs', import.meta.url)
  : new URL('./factor-worker.js', import.meta.url);

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
  options: { force?: boolean } = {},
): Promise<FactorWeatherRefreshResult> {
  const active = activeRefreshes.get(pinId);
  if (active) {
    return active;
  }

  const refresh = performRefresh(pinId, options).finally(() => activeRefreshes.delete(pinId));
  activeRefreshes.set(pinId, refresh);
  return refresh;
}

/** On API boot, a persisted running state can only belong to a worker killed with the old process. */
export async function resetInterruptedFactorWeatherRefreshes(): Promise<number> {
  const result = await prisma.factorWeatherPin.updateMany({
    where: { status: 'running' },
    data: { status: 'pending', error: null },
  });
  return result.count;
}

export async function refreshAllFactorWeatherPins(
  options: {
    onLog?: (line: string) => void;
  } = {},
): Promise<FactorWeatherRefreshResult[]> {
  const pins = await prisma.factorWeatherPin.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, factorName: true },
  });
  const results: FactorWeatherRefreshResult[] = [];

  for (const [index, pin] of pins.entries()) {
    options.onLog?.(`Factor weather ${index + 1}/${pins.length}: ${pin.factorName}`);
    try {
      results.push(await refreshFactorWeatherPin(pin.id));
    } catch (error) {
      options.onLog?.(
        `Factor weather failed for ${pin.factorName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return results;
}

async function performRefresh(
  pinId: string,
  options: { force?: boolean },
): Promise<FactorWeatherRefreshResult> {
  const pin = await prisma.factorWeatherPin.findUnique({ where: { id: pinId } });
  if (!pin) {
    return { pinId, computedThrough: null, pointsWritten: 0, skipped: true };
  }

  const completedThrough = await latestCompletedMonthEnd();
  if (!completedThrough) {
    await prisma.factorWeatherPin.update({
      where: { id: pinId },
      data: { status: 'error', error: 'No completed monthly market period is available.' },
    });
    return { pinId, computedThrough: null, pointsWritten: 0, skipped: true };
  }
  const requiresFullRefresh =
    Boolean(options.force) ||
    !pin.computedThrough ||
    pin.methodologyHash !== FACTOR_WEATHER_METHODOLOGY_HASH;
  if (!requiresFullRefresh && pin.status === 'ready' && pin.computedThrough === completedThrough) {
    return { pinId, computedThrough: completedThrough, pointsWritten: 0, skipped: true };
  }

  await prisma.factorWeatherPin.update({
    where: { id: pinId },
    data: { status: 'running', error: null },
  });

  try {
    const start = requiresFullRefresh
      ? await weatherHistoryStart(completedThrough)
      : await incrementalStart(pin.computedThrough!);
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
    );
    const observations = report.periodObservations ?? [];
    const newObservations = requiresFullRefresh
      ? observations
      : observations.filter((observation) => observation.periodEndDate > pin.computedThrough!);
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

    await prisma.$transaction(async (transaction) => {
      if (requiresFullRefresh) {
        await transaction.factorWeatherPoint.deleteMany({ where: { pinId } });
      } else {
        await transaction.factorWeatherPoint.deleteMany({
          where: { pinId, periodEndDate: { gt: pin.computedThrough! } },
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
          methodologyHash: FACTOR_WEATHER_METHODOLOGY_HASH,
        },
      });
    });

    return { pinId, computedThrough: completedThrough, pointsWritten: data.length, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.factorWeatherPin.updateMany({
      where: { id: pinId },
      data: { status: 'error', error: message },
    });
    throw error;
  }
}

async function latestCompletedMonthEnd(): Promise<string | null> {
  const currentMonthStart = shanghaiToday().slice(0, 6) + '01';
  const published = await prisma.maintenanceState.findUnique({
    where: { key: 'global' },
    select: { dailyPublishedThrough: true },
  });
  const marketCutoff =
    published?.dailyPublishedThrough ??
    (
      await prisma.daily.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
    )?.tradeDate;
  if (!marketCutoff) {
    return null;
  }

  const row = await prisma.tradeCal.findFirst({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { lt: currentMonthStart, lte: marketCutoff },
    },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  });
  return row?.calDate ?? null;
}

async function weatherHistoryStart(end: string): Promise<string> {
  const firstDaily = await prisma.daily.findFirst({
    where: { tradeDate: { gte: HISTORY_START, lte: end } },
    orderBy: { tradeDate: 'asc' },
    select: { tradeDate: true },
  });
  if (!firstDaily) {
    throw new Error('No market history is available for factor weather.');
  }
  return firstDaily.tradeDate;
}

async function incrementalStart(computedThrough: string): Promise<string> {
  const rows = await prisma.tradeCal.findMany({
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

function runWeatherWorker(
  factor: string,
  label: string,
  code: string,
  language: 'typescript' | 'python',
  runtimeVersion: string,
  spec: ReturnType<typeof createDefaultFactorAnalysisSpecV3>,
): Promise<FactorReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: {
        reportId: `weather:${factor}`,
        factor,
        source: { kind: 'single', code, label, language, runtimeVersion },
        spec,
        locale: 'zh',
      },
    });
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      handler();
    };

    worker.on('message', (message: { type: string; payload?: string; message?: string }) => {
      if (message.type === 'done' && message.payload) {
        const payload = message.payload;
        finish(() => resolve(JSON.parse(payload) as FactorReport));
      } else if (message.type === 'error') {
        finish(() => reject(new Error(message.message ?? 'Factor weather worker failed.')));
      }
    });
    worker.on('error', (error) => finish(() => reject(error)));
    worker.on('exit', (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`Factor weather worker exited with code ${code}.`)));
      }
    });
  });
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
