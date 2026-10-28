import { ResearchError } from '../errors.js';
import type {
  ResearchDiagnosticV1,
  ResearchFrequencyV1,
  ResearchSeriesInputSpecV1,
  ResearchTransformV1,
} from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';

/**
 * 保存研究序列的日期、数值及相关标记。
 *
 * Describe a dated research value and associated indicators.
 */
export interface ResearchSeriesPoint {
  date: string;
  value: number;
}

/**
 * 组合已加载序列与单位、来源及可得性说明。
 *
 * Collect loaded series with units, provenance and availability.
 */
export interface LoadedResearchSeries {
  points: ResearchSeriesPoint[];
  diagnostics: ResearchDiagnosticV1[];
}

export type ResearchSeriesLoader = (
  input: ResearchSeriesInputSpecV1,
  start: string,
  end: string,
) => Promise<LoadedResearchSeries>;

/**
 * 区分加载预热区间和实际输出区间。
 *
 * Separate warm-up loading bounds from requested output bounds.
 */
export interface ResearchSeriesPreparationRange {
  start: string;
  end: string;
  partialPeriod: 'exclude' | 'include';
}

/**
 * 解析受控序列身份、加载来源并应用频率与变换，保留单位和可得性元数据。
 *
 * Resolve a governed series, load its source and apply frequency and transforms with units and availability metadata.
 */
export const loadResearchSeries: ResearchSeriesLoader = async (input, start, end) => {
  switch (input.source.kind) {
    case 'instrument':
      return loadInstrumentSeries(input.source, input.measure, start, end);
  }
};

/**
 * 按请求窗口重采样并变换预载数据，裁剪输出至目标范围。
 *
 * Resample and transform preloaded data and trim output to the requested window.
 */
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

/**
 * 为首个输出观测预留变换所需历史，避免窗口起点计算不足。
 *
 * Load enough history before the requested window to compute its first transformed observation.
 */
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

/**
 * 将已按时点对齐的序列聚合为所请求频率。
 *
 * Resample an availability-aligned series to the requested frequency.
 */
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

/**
 * 对有序序列执行请求变换，并保留缺失与预热限制。
 *
 * Apply the requested transform to an ordered series with explicit missing and warm-up behavior.
 */
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

/**
 * 读取已验证证券的价格序列并映射研究指标。
 *
 * Load a verified instrument's prices and map the requested research measure.
 */
async function loadInstrumentSeries(
  source: Extract<ResearchSeriesInputSpecV1['source'], { kind: 'instrument' }>,
  measure: string,
  start: string,
  end: string,
): Promise<LoadedResearchSeries> {
  const { assetType, id } = source;
  if (measure !== 'market.adjusted_close' || (assetType === 'index' && id.startsWith('equity.'))) {
    throw new ResearchError('dataset_retired');
  }

  if (assetType === 'index') {
    const rows = await getDatabase().indexDaily.findMany({
      where: { tsCode: id, tradeDate: { gte: start, lte: end } },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    });
    return {
      points: rows.map((row) => ({ date: row.tradeDate, value: row.close })),
      diagnostics: [],
    };
  }

  const isEtf = assetType === 'etf';
  const [prices, adjustments] = isEtf
    ? await Promise.all([
        getDatabase().etfDaily.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, close: true },
          orderBy: { tradeDate: 'asc' },
        }),
        getDatabase().etfAdjFactor.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, adjFactor: true },
        }),
      ])
    : await Promise.all([
        getDatabase().daily.findMany({
          where: { tsCode: id, tradeDate: { gte: start, lte: end } },
          select: { tradeDate: true, close: true },
          orderBy: { tradeDate: 'asc' },
        }),
        getDatabase().adjFactor.findMany({
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

function calendarMonthEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/**
 * 按自然月偏移加载起点，供变换预热。
 *
 * Shift loading bounds by calendar months for transform warm-up.
 */
function shiftMonth(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(4, 6)) - 1;
  const shifted = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}01`;
}

/**
 * 按自然日偏移查询范围，供历史预热读取。
 *
 * Shift date bounds by calendar days for historical warm-up.
 */
function shiftCalendarDays(date: string, offset: number): string {
  const value = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))),
  );
  value.setUTCDate(value.getUTCDate() + offset);
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
}
