import { addDays } from '#date';
import { USD_CNH_CODE, USD_HKD_CODE } from '../registry/fx.js';
import {
  type CrossMarketBenchmarkDefinition,
  CNY_BASE_CURRENCY,
} from '../registry/cross-market-benchmarks.js';

/**
 * 携带本币基准收盘及日期，供人民币换算。
 * Supply dated local benchmark closes for CNY conversion.
 */
export interface BenchmarkClosePoint {
  date: string;
  value: number;
}

/**
 * 携带汇率中间价及可得日期，供基准时点换算。
 * Supply FX mid closes and availability dates for dated conversion.
 */
export interface BenchmarkFxRow {
  tsCode: string;
  tradeDate: string;
  availableDate: string;
  bidClose: number;
  askClose: number;
}

/**
 * 在已审计的中国研究时钟上，将本地价格指数转换为人民币计价收盘。
 * Convert each local price index to a CNY-denominated close on the audited China study clock.
 */
export function deriveBenchmarkCnyCloses(
  benchmark: Pick<CrossMarketBenchmarkDefinition, 'market' | 'currency'>,
  benchmarkRows: Array<{ availableDate: string; close: number }>,
  fxRows: BenchmarkFxRow[],
): { points: BenchmarkClosePoint[]; missingFxDates: string[] } {
  if (benchmark.currency === CNY_BASE_CURRENCY) {
    return {
      points: benchmarkRows.map((row) => ({ date: row.availableDate, value: row.close })),
      missingFxDates: [],
    };
  }
  const fxByCode = new Map<string, BenchmarkFxRow[]>();
  for (const row of fxRows) {
    const values = fxByCode.get(row.tsCode) ?? [];
    values.push(row);
    fxByCode.set(row.tsCode, values);
  }
  for (const values of fxByCode.values()) {
    values.sort(compareFxRows);
  }
  const points: BenchmarkClosePoint[] = [];
  const missingFxDates: string[] = [];
  for (const row of benchmarkRows) {
    const usdCnh = latestMidClose(fxByCode.get(USD_CNH_CODE) ?? [], row.availableDate);
    const conversion =
      benchmark.currency === 'USD'
        ? usdCnh
        : divideOrNull(usdCnh, latestMidClose(fxByCode.get(USD_HKD_CODE) ?? [], row.availableDate));
    if (conversion == null) {
      missingFxDates.push(row.availableDate);
      continue;
    }
    points.push({ date: row.availableDate, value: row.close * conversion });
  }
  return { points, missingFxDates };
}

/**
 * 由两个已明确存储的 FXCM 货币对推导 HKD/CNH，不宣称存在直接报价。
 * Derive HKD/CNH from two explicitly stored FXCM pairs; no direct pair is claimed.
 */
export function deriveHkdCnhMidCloses(
  fxRows: BenchmarkFxRow[],
  startDate: string,
  endDate: string,
): BenchmarkClosePoint[] {
  const dates = [...new Set(fxRows.map((row) => row.availableDate))]
    .filter((date) => date >= startDate && date <= endDate)
    .sort();
  const usdCnh = fxRows.filter((row) => row.tsCode === USD_CNH_CODE).sort(compareFxRows);
  const usdHkd = fxRows.filter((row) => row.tsCode === USD_HKD_CODE).sort(compareFxRows);
  return dates.flatMap((date) => {
    const value = divideOrNull(latestMidClose(usdCnh, date), latestMidClose(usdHkd, date));
    return value == null ? [] : [{ date, value }];
  });
}

/**
 * 选择截至目标日期最近可用的外汇中间价，供基准换算。
 * Select the latest available FX mid close for benchmark conversion.
 */
function latestMidClose(rows: BenchmarkFxRow[], date: string): number | null {
  let latest: BenchmarkFxRow | null = null;
  for (const row of rows) {
    if (row.availableDate > date) {
      break;
    }
    latest = row;
  }
  if (
    !latest ||
    latest.availableDate < addDays(date, -7) ||
    latest.bidClose <= 0 ||
    latest.askClose < latest.bidClose
  ) {
    return null;
  }
  return (latest.bidClose + latest.askClose) / 2;
}

function compareFxRows(left: BenchmarkFxRow, right: BenchmarkFxRow): number {
  return (
    left.availableDate.localeCompare(right.availableDate) ||
    left.tradeDate.localeCompare(right.tradeDate)
  );
}

function divideOrNull(numerator: number | null, denominator: number | null): number | null {
  return numerator == null || denominator == null || denominator === 0
    ? null
    : numerator / denominator;
}
