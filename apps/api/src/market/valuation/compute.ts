import type {
  IndexValuationMetric,
  IndexValuationMetricSummary,
  IndexValuationPoint,
  IndexValuationSeries,
} from '@jixie/shared';

/**
 * 提供指数官方估值历史，供分位序列计算。
 * Supply official index valuation history for percentile series.
 */
type IndexBasicRow = {
  tsCode: string;
  tradeDate: string;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  turnoverRate: number | null;
};

type IndexCloseRow = {
  tradeDate: string;
  close: number;
};

const METRICS: IndexValuationMetric[] = ['peTtm', 'pb', 'pe', 'turnoverRate'];

/**
 * 按指数历史估值计算可展示数值及分位序列，保留缺失。
 * Build index valuation and historical-percentile series while preserving missing values.
 */
export function buildIndexValuationSeries(
  tsCode: string,
  basicRows: IndexBasicRow[],
  closeRows: IndexCloseRow[],
): IndexValuationSeries | null {
  if (basicRows.length === 0) {
    return null;
  }

  const closeByDate = new Map(closeRows.map((row) => [row.tradeDate, row.close]));
  const points: IndexValuationPoint[] = basicRows.flatMap((row) => {
    const close = closeByDate.get(row.tradeDate);
    return close == null
      ? []
      : [
          {
            date: row.tradeDate,
            close,
            pe: row.pe,
            peTtm: row.peTtm,
            pb: row.pb,
            turnoverRate: row.turnoverRate,
          },
        ];
  });
  if (points.length === 0) {
    return null;
  }

  const asOf = points.at(-1)!.date;
  const tenYearStart = subtractCalendarYears(asOf, 10);
  const tenYearPoints = points.filter((point) => point.date >= tenYearStart);
  const summaries = Object.fromEntries(
    METRICS.map((metric) => [metric, summarizeMetric(points, tenYearPoints, metric)]),
  ) as Record<IndexValuationMetric, IndexValuationMetricSummary>;

  return { tsCode, asOf, tenYearStart, points, summaries };
}

function summarizeMetric(
  allPoints: IndexValuationPoint[],
  tenYearPoints: IndexValuationPoint[],
  metric: IndexValuationMetric,
): IndexValuationMetricSummary {
  const value = lastNonNull(allPoints, metric);
  if (value == null) {
    return { value: null, percentile10Year: null, percentileAll: null };
  }

  return {
    value,
    percentile10Year: percentileRank(tenYearPoints, metric, value),
    percentileAll: percentileRank(allPoints, metric, value),
  };
}

function lastNonNull(points: IndexValuationPoint[], metric: IndexValuationMetric): number | null {
  for (let index = points.length - 1; index >= 0; index--) {
    const value = points[index][metric];
    if (value != null) {
      return value;
    }
  }

  return null;
}

/**
 * 计算当前数值在已提供历史样本中的分位位置。
 * Compute a value's percentile position within the supplied historical sample.
 */
function percentileRank(
  points: IndexValuationPoint[],
  metric: IndexValuationMetric,
  current: number,
): number | null {
  let valid = 0;
  let atOrBelow = 0;

  for (const point of points) {
    const value = point[metric];
    if (value == null) {
      continue;
    }

    valid++;
    if (value <= current) {
      atOrBelow++;
    }
  }

  return valid > 0 ? atOrBelow / valid : null;
}

function subtractCalendarYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}
