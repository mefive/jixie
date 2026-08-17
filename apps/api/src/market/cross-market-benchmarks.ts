import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import {
  assignExternalAvailableDates,
  USD_CNH_CODE,
  USD_HKD_CODE,
} from '../rates/external-market-drivers.js';
import type { TushareRow } from '../tushare/client.js';

export const CNY_BASE_CURRENCY = 'CNY';
export const HKD_CNH_DERIVED_CODE = 'HKDCNH.DERIVED';

export type CrossMarketBenchmarkMarket = 'CN' | 'HK' | 'US';

export interface CrossMarketBenchmarkDefinition {
  id: string;
  provider: 'Tushare Pro';
  providerCode: string;
  sourceApi: 'index_daily' | 'index_global';
  nameZh: string;
  nameEn: string;
  market: CrossMarketBenchmarkMarket;
  currency: 'CNY' | 'HKD' | 'USD';
  timeZone: string;
  calendarId: string;
  observesDaylightSavingTime: boolean;
  returnType: 'price_return';
  dataContractId: string;
  tradableProxyTsCode: string;
  tradableProxyKind: 'domestic_etf' | 'qdii_etf';
}

export const CROSS_MARKET_BENCHMARKS = [
  {
    id: 'equity.cn.csi300.price',
    provider: 'Tushare Pro',
    providerCode: '000300.SH',
    sourceApi: 'index_daily',
    nameZh: '沪深 300 价格指数',
    nameEn: 'CSI 300 Price Index',
    market: 'CN',
    currency: 'CNY',
    timeZone: 'Asia/Shanghai',
    calendarId: 'SSE_SZSE',
    observesDaylightSavingTime: false,
    returnType: 'price_return',
    dataContractId: 'cn.equity_benchmark.price.daily',
    tradableProxyTsCode: '510300.SH',
    tradableProxyKind: 'domestic_etf',
  },
  {
    id: 'equity.hk.hsi.price',
    provider: 'Tushare Pro',
    providerCode: 'HSI',
    sourceApi: 'index_global',
    nameZh: '恒生价格指数',
    nameEn: 'Hang Seng Price Index',
    market: 'HK',
    currency: 'HKD',
    timeZone: 'Asia/Hong_Kong',
    calendarId: 'HKEX',
    observesDaylightSavingTime: false,
    returnType: 'price_return',
    dataContractId: 'hk.equity_benchmark.price.daily',
    tradableProxyTsCode: '159920.SZ',
    tradableProxyKind: 'qdii_etf',
  },
  {
    id: 'equity.us.spx.price',
    provider: 'Tushare Pro',
    providerCode: 'SPX',
    sourceApi: 'index_global',
    nameZh: '标普 500 价格指数',
    nameEn: 'S&P 500 Price Index',
    market: 'US',
    currency: 'USD',
    timeZone: 'America/New_York',
    calendarId: 'NYSE_NASDAQ',
    observesDaylightSavingTime: true,
    returnType: 'price_return',
    dataContractId: 'us.equity_benchmark.price.daily',
    tradableProxyTsCode: '513500.SH',
    tradableProxyKind: 'qdii_etf',
  },
] as const satisfies readonly CrossMarketBenchmarkDefinition[];

export const CROSS_MARKET_BENCHMARK_BY_ID: ReadonlyMap<string, CrossMarketBenchmarkDefinition> =
  new Map(CROSS_MARKET_BENCHMARKS.map((benchmark) => [benchmark.id, benchmark]));

export interface CrossMarketBenchmarkBar {
  benchmarkId: string;
  tradeDate: string;
  availableDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  preClose: number | null;
  change: number | null;
  pctChange: number | null;
  swing: number | null;
  volume: number | null;
}

export interface BenchmarkClosePoint {
  date: string;
  value: number;
}

export interface BenchmarkFxRow {
  tsCode: string;
  tradeDate: string;
  availableDate: string;
  bidClose: number;
  askClose: number;
}

export interface CrossMarketBenchmarkSyncSummary {
  benchmarkRows: Record<string, number>;
}

export interface CrossMarketBenchmarkClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

const INDEX_DAILY_FIELDS = 'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol';
const INDEX_GLOBAL_FIELDS =
  'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,swing,vol';

/** Validate and normalize one provider slice without changing its price-index semantics. */
export function parseCrossMarketBenchmarkRows(
  definition: CrossMarketBenchmarkDefinition,
  rows: TushareRow[],
  startDate: string,
  endDate: string,
): Omit<CrossMarketBenchmarkBar, 'availableDate'>[] {
  assertDateRange(startDate, endDate);
  const dates = new Set<string>();
  return rows
    .map((row) => {
      const providerCode = requiredString(row, 'ts_code');
      const tradeDate = requiredString(row, 'trade_date');
      if (
        providerCode !== definition.providerCode ||
        !/^\d{8}$/.test(tradeDate) ||
        tradeDate < startDate ||
        tradeDate > endDate
      ) {
        throw new Error(
          `Cross-market benchmark ${definition.id} returned invalid identity ${providerCode} ${tradeDate}`,
        );
      }
      if (dates.has(tradeDate)) {
        throw new Error(`Cross-market benchmark ${definition.id} returned duplicate ${tradeDate}`);
      }
      dates.add(tradeDate);
      const close = requiredNumber(row, 'close');
      const open = optionalNumber(row, 'open');
      const high = optionalNumber(row, 'high');
      const low = optionalNumber(row, 'low');
      const preClose = optionalNumber(row, 'pre_close');
      const volume = optionalNumber(row, 'vol');
      if (
        close <= 0 ||
        [open, high, low, preClose].some((value) => value != null && value <= 0) ||
        (volume != null && volume < 0) ||
        (high != null && low != null && high < low) ||
        outsideDailyRange(close, low, high)
      ) {
        throw new Error(
          `Cross-market benchmark ${definition.id} returned invalid bar ${tradeDate}`,
        );
      }
      return {
        benchmarkId: definition.id,
        tradeDate,
        open,
        high,
        low,
        close,
        preClose,
        change: optionalNumber(row, 'change'),
        pctChange: optionalNumber(row, 'pct_chg'),
        swing: optionalNumber(row, 'swing'),
        volume,
      };
    })
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** Convert each local price index to a CNY-denominated close on the audited China study clock. */
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

/** Derive HKD/CNH from two explicitly stored FXCM pairs; no direct pair is claimed. */
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

/** Idempotently synchronize the fixed CN/HK/US benchmark set in bounded five-year slices. */
export async function syncCrossMarketBenchmarks(
  client: CrossMarketBenchmarkClient,
  startDate: string,
  endDate: string,
  onLog: (line: string) => void = console.log,
): Promise<CrossMarketBenchmarkSyncSummary> {
  assertDateRange(startDate, endDate);
  await seedCrossMarketBenchmarks();
  const summary: CrossMarketBenchmarkSyncSummary = { benchmarkRows: {} };
  for (const range of fiveYearRanges(startDate, endDate)) {
    const calendarRows = await prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gt: range.startDate, lte: addDays(range.endDate, 14) },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    });
    const openDates = calendarRows.map((row) => row.calDate);
    for (const definition of CROSS_MARKET_BENCHMARKS) {
      const rows = await client.call(
        definition.sourceApi,
        {
          ts_code: definition.providerCode,
          start_date: range.startDate,
          end_date: range.endDate,
        },
        definition.sourceApi === 'index_global' ? INDEX_GLOBAL_FIELDS : INDEX_DAILY_FIELDS,
      );
      const parsed = parseCrossMarketBenchmarkRows(
        definition,
        rows,
        range.startDate,
        range.endDate,
      );
      const normalized =
        definition.market === 'CN'
          ? parsed.map((row) => ({ ...row, availableDate: row.tradeDate }))
          : assignExternalAvailableDates(parsed, openDates);
      const retrievedAt = new Date();
      if (normalized.length > 0) {
        await prisma.$transaction([
          prisma.marketBenchmarkDaily.deleteMany({
            where: {
              benchmarkId: definition.id,
              tradeDate: { gte: range.startDate, lte: range.endDate },
            },
          }),
          prisma.marketBenchmarkDaily.createMany({
            data: normalized.map((row) => ({ ...row, retrievedAt })),
          }),
        ]);
      }
      summary.benchmarkRows[definition.id] =
        (summary.benchmarkRows[definition.id] ?? 0) + normalized.length;
      onLog(
        `Cross-market benchmark ${definition.id} ${range.startDate}..${range.endDate}: ${normalized.length} rows`,
      );
    }
  }
  return summary;
}

export async function seedCrossMarketBenchmarks(): Promise<void> {
  await prisma.$transaction(
    CROSS_MARKET_BENCHMARKS.map((benchmark) =>
      prisma.marketBenchmark.upsert({
        where: { id: benchmark.id },
        create: benchmarkReferenceRow(benchmark),
        update: benchmarkReferenceRow(benchmark),
      }),
    ),
  );
}

function benchmarkReferenceRow(benchmark: CrossMarketBenchmarkDefinition) {
  return {
    id: benchmark.id,
    provider: benchmark.provider,
    providerCode: benchmark.providerCode,
    nameZh: benchmark.nameZh,
    nameEn: benchmark.nameEn,
    market: benchmark.market,
    currency: benchmark.currency,
    timeZone: benchmark.timeZone,
    calendarId: benchmark.calendarId,
    observesDaylightSavingTime: benchmark.observesDaylightSavingTime,
    returnType: benchmark.returnType,
    dataContractId: benchmark.dataContractId,
    tradableProxyTsCode: benchmark.tradableProxyTsCode,
    tradableProxyKind: benchmark.tradableProxyKind,
  };
}

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

function outsideDailyRange(value: number | null, low: number | null, high: number | null): boolean {
  if (value == null || low == null || high == null) {
    return false;
  }
  // An index open can sit outside the later intraday range because constituents open at different
  // times, so only the close is checked here. index_global also contains a few historical one-tick
  // rounding disagreements (for example SPX 2008-09-29 close 1106.39 versus low 1106.42). Preserve
  // the raw fields but reject material close/range contradictions beyond the larger of 0.1 index
  // point or one tenth of a basis point.
  const tolerance = Math.max(0.1, Math.abs(value) * 0.00001);
  return value < low - tolerance || value > high + tolerance;
}

function requiredString(row: TushareRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Cross-market benchmark omitted ${field}`);
  }
  return value;
}

function requiredNumber(row: TushareRow, field: string): number {
  const value = optionalNumber(row, field);
  if (value == null) {
    throw new Error(`Cross-market benchmark omitted ${field}`);
  }
  return value;
}

function optionalNumber(row: TushareRow, field: string): number | null {
  const value = row[field];
  if (value == null || value === '') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Cross-market benchmark returned invalid ${field}`);
  }
  return number;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('Cross-market benchmark dates must use an ordered YYYYMMDD range');
  }
}

function fiveYearRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year += 5) {
    ranges.push({
      startDate: startDate > `${year}0101` ? startDate : `${year}0101`,
      endDate: endDate < `${year + 4}1231` ? endDate : `${year + 4}1231`,
    });
  }
  return ranges;
}
