import type {
  ResearchDiagnosticV1,
  ResearchFrequencyV1,
  ResearchSeriesInputSpecV1,
  ResearchTransformV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

export interface ResearchSeriesPoint {
  date: string;
  value: number;
}

export interface LoadedResearchSeries {
  points: ResearchSeriesPoint[];
  diagnostics: ResearchDiagnosticV1[];
}

export interface MacroResearchObservationRow {
  period: string;
  vintageDate: string;
  value: number;
  availableDate: string;
  vintageKind: string;
}

export type ResearchSeriesLoader = (
  input: ResearchSeriesInputSpecV1,
  start: string,
  end: string,
) => Promise<LoadedResearchSeries>;

export interface ResearchSeriesPreparationRange {
  start: string;
  end: string;
  partialPeriod: 'exclude' | 'include';
}

export const loadResearchSeries: ResearchSeriesLoader = async (input, start, end) => {
  switch (input.source.kind) {
    case 'instrument':
      return loadInstrumentSeries(input.source, start, end);
    case 'macro':
      return loadMacroSeries(input.source.seriesKey, start, end);
    case 'yield_curve':
      return loadYieldCurveSeries(input.source, start, end);
    case 'fx':
      return loadFxSeries(input.source.id, start, end);
  }
};

export function prepareResearchSeries(
  points: ResearchSeriesPoint[],
  frequency: ResearchFrequencyV1,
  transform: ResearchTransformV1,
  range?: ResearchSeriesPreparationRange,
): ResearchSeriesPoint[] {
  const sampled = resampleSeries(points, frequency);
  const transformed = transformSeries(sampled, transform, frequency);
  if (!range) {
    return transformed;
  }
  const lower = frequency === 'monthly' ? calendarMonthEnd(range.start) : range.start;
  const upper = frequency === 'monthly' ? calendarMonthEnd(range.end) : range.end;
  const incompleteFinalMonth =
    frequency === 'monthly' &&
    range.partialPeriod === 'exclude' &&
    range.end < calendarMonthEnd(range.end);
  return transformed.filter(
    (point) =>
      point.date >= lower && point.date <= upper && !(incompleteFinalMonth && point.date === upper),
  );
}

/** Load enough history before the requested window to compute its first transformed observation. */
export function researchSeriesLoadStart(
  start: string,
  frequency: ResearchFrequencyV1,
  transform: ResearchTransformV1,
): string {
  if (transform === 'level') {
    return start;
  }
  if (frequency === 'monthly') {
    return shiftMonth(start, transform === 'year_over_year' ? -12 : -1);
  }
  // One daily change needs the previous trading observation. Two calendar weeks cover exchange
  // holidays without encoding one market's calendar into the generic research protocol.
  return shiftCalendarDays(start, -14);
}

export function resampleSeries(
  points: ResearchSeriesPoint[],
  frequency: ResearchFrequencyV1,
): ResearchSeriesPoint[] {
  const valid = points
    .filter((point) => /^\d{8}$/.test(point.date) && Number.isFinite(point.value))
    .sort((left, right) => left.date.localeCompare(right.date));
  const byPeriod = new Map<string, ResearchSeriesPoint>();
  for (const point of valid) {
    const period = frequency === 'monthly' ? point.date.slice(0, 6) : point.date;
    const previous = byPeriod.get(period);
    if (!previous || point.date >= previous.date) {
      byPeriod.set(period, point);
    }
  }
  return [...byPeriod.entries()]
    .map(([period, point]) => ({
      date: frequency === 'monthly' ? calendarMonthEnd(`${period}01`) : point.date,
      value: point.value,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function transformSeries(
  points: ResearchSeriesPoint[],
  transform: ResearchTransformV1,
  frequency: ResearchFrequencyV1,
): ResearchSeriesPoint[] {
  if (transform === 'level') {
    return points.map((point) => ({ ...point }));
  }
  if (transform === 'year_over_year') {
    if (frequency !== 'monthly') {
      throw new Error('year_over_year requires monthly alignment');
    }
    const valueByMonth = new Map(points.map((point) => [point.date.slice(0, 6), point.value]));
    return points.flatMap((point) => {
      const month = point.date.slice(0, 6);
      const previousMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4, 6)}`;
      const previous = valueByMonth.get(previousMonth);
      return previous == null || previous === 0
        ? []
        : [{ date: point.date, value: (point.value / previous - 1) * 100 }];
    });
  }

  const transformed: ResearchSeriesPoint[] = [];
  for (let index = 1; index < points.length; index++) {
    const current = points[index]!;
    const previous = points[index - 1]!;
    if (transform === 'difference') {
      transformed.push({ date: current.date, value: current.value - previous.value });
      continue;
    }
    if (previous.value === 0) {
      continue;
    }
    const change = current.value / previous.value - 1;
    transformed.push({
      date: current.date,
      value: transform === 'percent_change' ? change * 100 : change,
    });
  }
  return transformed;
}

async function loadInstrumentSeries(
  source: Extract<ResearchSeriesInputSpecV1['source'], { kind: 'instrument' }>,
  start: string,
  end: string,
): Promise<LoadedResearchSeries> {
  const { assetType, id } = source;
  if (assetType === 'index') {
    const rows = await prisma.indexDaily.findMany({
      where: { tsCode: id, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    });
    return {
      points: rows.map((row) => ({ date: row.tradeDate, value: row.close })),
      diagnostics: [],
    };
  }
  if (assetType === 'future') {
    return loadFutureSeries(id, start, end);
  }

  const isEtf = assetType === 'etf';
  const [prices, adjustments] = isEtf
    ? await Promise.all([
        prisma.etfDaily.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, close: true },
          orderBy: { tradeDate: 'asc' },
        }),
        prisma.etfAdjFactor.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, adjFactor: true },
        }),
      ])
    : await Promise.all([
        prisma.daily.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, close: true },
          orderBy: { tradeDate: 'asc' },
        }),
        prisma.adjFactor.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, adjFactor: true },
        }),
      ]);
  const factorByDate = new Map(adjustments.map((row) => [row.tradeDate, row.adjFactor]));
  const missingAdjustments = prices.filter(
    (row) => row.close != null && factorByDate.get(row.tradeDate) == null,
  ).length;
  return {
    points: prices.flatMap((row) => {
      const factor = factorByDate.get(row.tradeDate);
      return row.close == null || factor == null
        ? []
        : [{ date: row.tradeDate, value: row.close * factor }];
    }),
    diagnostics:
      missingAdjustments === 0
        ? []
        : [
            {
              code: 'missing_adjustment_factor',
              severity: 'warning',
              messageZh: `${missingAdjustments} 个价格点缺少复权因子并已排除。`,
              messageEn: `${missingAdjustments} price observations lacked adjustment factors and were excluded.`,
            },
          ],
  };
}

async function loadFutureSeries(
  id: string,
  start: string,
  end: string,
): Promise<LoadedResearchSeries> {
  const mappings = await prisma.futureMapping.findMany({
    where: { continuousCode: id, tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, mappedTsCode: true },
    orderBy: { tradeDate: 'asc' },
  });
  const actualCodes = mappings.length
    ? [...new Set(mappings.map((row) => row.mappedTsCode))]
    : [id];
  const rows = await prisma.futureDaily.findMany({
    where: { tsCode: { in: actualCodes }, tradeDate: { gte: start, lte: end } },
    select: { tsCode: true, tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  const rowByKey = new Map(rows.map((row) => [`${row.tsCode}|${row.tradeDate}`, row]));
  const selected = mappings.length
    ? mappings.flatMap((mapping) => {
        const row = rowByKey.get(`${mapping.mappedTsCode}|${mapping.tradeDate}`);
        return row ? [row] : [];
      })
    : rows;
  return {
    points: selected.flatMap((row) =>
      row.close == null ? [] : [{ date: row.tradeDate, value: row.close }],
    ),
    diagnostics: [],
  };
}

async function loadMacroSeries(
  seriesKey: string,
  start: string,
  end: string,
): Promise<LoadedResearchSeries> {
  const rows = await prisma.macroObservation.findMany({
    where: { seriesKey, availableDate: { lte: end } },
    select: {
      period: true,
      vintageDate: true,
      value: true,
      availableDate: true,
      vintageKind: true,
    },
    orderBy: [{ period: 'asc' }, { availableDate: 'asc' }, { vintageDate: 'asc' }],
  });
  return selectMacroResearchSeries(rows, start, end);
}

/**
 * Align macro values to their audited market availability while choosing the earliest captured
 * vintage per period. Historical latest-value imports remain usable for exploratory work, but the
 * returned diagnostic prevents them from being described as real-time vintage data.
 */
export function selectMacroResearchSeries(
  rows: MacroResearchObservationRow[],
  start: string,
  end: string,
): LoadedResearchSeries {
  const firstAvailableByPeriod = new Map<string, MacroResearchObservationRow>();
  for (const row of rows) {
    if (row.availableDate < start || row.availableDate > end) {
      continue;
    }
    const previous = firstAvailableByPeriod.get(row.period);
    if (
      !previous ||
      row.availableDate < previous.availableDate ||
      (row.availableDate === previous.availableDate && row.vintageDate < previous.vintageDate)
    ) {
      firstAvailableByPeriod.set(row.period, row);
    }
  }
  const selected = [...firstAvailableByPeriod.values()].sort((left, right) =>
    left.availableDate.localeCompare(right.availableDate),
  );
  const backfilled = selected.filter((row) => row.vintageKind === 'latest_value_backfill').length;
  return {
    points: selected.map((row) => ({
      date: row.availableDate,
      value: row.value,
    })),
    diagnostics:
      backfilled === 0
        ? []
        : [
            {
              code: 'macro_latest_value_backfill',
              severity: 'warning',
              messageZh: `${backfilled} 个宏观观测使用导入时可得的最新历史值，并按保守可用日对齐；可用于探索性研究，但不能视为历史实时版本。`,
              messageEn: `${backfilled} macro observations use latest historical values as of import and are aligned by conservative availability dates; they support exploratory research but are not historical real-time vintages.`,
            },
          ],
  };
}

async function loadYieldCurveSeries(
  source: Extract<ResearchSeriesInputSpecV1['source'], { kind: 'yield_curve' }>,
  start: string,
  end: string,
): Promise<LoadedResearchSeries> {
  const rows = await prisma.yieldCurvePoint.findMany({
    where: {
      curveCode: source.curveCode,
      curveType: source.curveType,
      termYears: source.termYears,
      availableDate: { gte: start, lte: end },
    },
    select: { availableDate: true, yieldPct: true },
    orderBy: { availableDate: 'asc' },
  });
  return {
    points: rows.map((row) => ({ date: row.availableDate, value: row.yieldPct })),
    diagnostics: [],
  };
}

async function loadFxSeries(id: string, start: string, end: string): Promise<LoadedResearchSeries> {
  const rows = await prisma.fxDaily.findMany({
    where: { tsCode: id, availableDate: { gte: start, lte: end } },
    select: { availableDate: true, bidClose: true, askClose: true },
    orderBy: { availableDate: 'asc' },
  });
  return {
    points: rows.map((row) => ({
      date: row.availableDate,
      value: (row.bidClose + row.askClose) / 2,
    })),
    diagnostics: [],
  };
}

function calendarMonthEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function shiftMonth(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(4, 6)) - 1;
  const shifted = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}01`;
}

function shiftCalendarDays(date: string, offset: number): string {
  const value = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  value.setUTCDate(value.getUTCDate() + offset);
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
}
