import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { TushareRow } from '../tushare/client.js';

export const US_NOMINAL_CURVE_SOURCE = 'tushare_us_treasury';
export const US_NOMINAL_CURVE_CODE = 'us_treasury_nominal';
export const US_NOMINAL_CURVE_NAME = '美国国债名义收益率曲线';
export const US_REAL_CURVE_SOURCE = 'tushare_us_treasury';
export const US_REAL_CURVE_CODE = 'us_treasury_real';
export const US_REAL_CURVE_NAME = '美国国债实际收益率曲线';
export const US_TREASURY_CURVE_TYPE = 'par';
export const USD_CNH_CODE = 'USDCNH.FXCM';
export const FXCM_EXCHANGE = 'FXCM';

const NOMINAL_TERMS = [
  { field: 'm1', termYears: 1 / 12 },
  { field: 'm2', termYears: 2 / 12 },
  { field: 'm3', termYears: 0.25 },
  { field: 'm6', termYears: 0.5 },
  { field: 'y1', termYears: 1 },
  { field: 'y2', termYears: 2 },
  { field: 'y3', termYears: 3 },
  { field: 'y5', termYears: 5 },
  { field: 'y7', termYears: 7 },
  { field: 'y10', termYears: 10 },
  { field: 'y20', termYears: 20 },
  { field: 'y30', termYears: 30 },
] as const;

const REAL_TERMS = [
  { field: 'y5', termYears: 5 },
  { field: 'y7', termYears: 7 },
  { field: 'y10', termYears: 10 },
  { field: 'y20', termYears: 20 },
  { field: 'y30', termYears: 30 },
] as const;

const NOMINAL_FIELDS = `date,${NOMINAL_TERMS.map((term) => term.field).join(',')}`;
const REAL_FIELDS = `date,${REAL_TERMS.map((term) => term.field).join(',')}`;
const FX_FIELDS =
  'ts_code,trade_date,bid_open,bid_close,bid_high,bid_low,ask_open,ask_close,ask_high,ask_low,tick_qty';

export interface ExternalMarketClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface ExternalYieldCurvePoint {
  tradeDate: string;
  termYears: number;
  yieldPct: number;
}

export interface ExternalFxDailyBar {
  tsCode: string;
  tradeDate: string;
  exchange: string;
  bidOpen: number;
  bidClose: number;
  bidHigh: number;
  bidLow: number;
  askOpen: number;
  askClose: number;
  askHigh: number;
  askLow: number;
  tickQty: number;
}

export interface ExternalMarketSyncSummary {
  nominalCurvePoints: number;
  realCurvePoints: number;
  fxBars: number;
}

/** Parse a Tushare US Treasury response without interpolating absent tenors. */
export function parseExternalYieldCurveRows(
  rows: TushareRow[],
  kind: 'nominal' | 'real',
  startDate: string,
  endDate: string,
): ExternalYieldCurvePoint[] {
  assertDateRange(startDate, endDate);
  const terms = kind === 'nominal' ? NOMINAL_TERMS : REAL_TERMS;
  const identities = new Set<string>();
  const dates = new Set<string>();
  const points: ExternalYieldCurvePoint[] = [];
  for (const row of rows) {
    const tradeDate = stringField(row, 'date');
    if (!isDate(tradeDate) || tradeDate < startDate || tradeDate > endDate) {
      throw new Error(`Tushare US ${kind} curve returned invalid date ${tradeDate}`);
    }
    if (dates.has(tradeDate)) {
      throw new Error(`Tushare US ${kind} curve returned duplicate date ${tradeDate}`);
    }
    dates.add(tradeDate);
    for (const term of terms) {
      const value = numericField(row, term.field);
      if (value == null) {
        continue;
      }
      if (value <= -10 || value >= 30) {
        throw new Error(
          `Tushare US ${kind} curve returned invalid ${term.field} yield on ${tradeDate}`,
        );
      }
      const identity = `${tradeDate}|${term.termYears}`;
      if (identities.has(identity)) {
        throw new Error(`Tushare US ${kind} curve returned duplicate point ${identity}`);
      }
      identities.add(identity);
      points.push({ tradeDate, termYears: term.termYears, yieldPct: value });
    }
    // The nominal endpoint emits all-null placeholder rows on some US market holidays (for
    // example 2010-10-11). They are not observations and must not be forward-filled.
  }
  return points.sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) || left.termYears - right.termYears,
  );
}

/** Parse raw USD/CNH bid/ask bars and fail closed on inverted or impossible quotes. */
export function parseUsdCnhRows(
  rows: TushareRow[],
  startDate: string,
  endDate: string,
): ExternalFxDailyBar[] {
  assertDateRange(startDate, endDate);
  const dates = new Set<string>();
  const bars: ExternalFxDailyBar[] = [];
  for (const row of rows) {
    const tsCode = stringField(row, 'ts_code');
    const tradeDate = stringField(row, 'trade_date');
    if (
      tsCode !== USD_CNH_CODE ||
      !isDate(tradeDate) ||
      tradeDate < startDate ||
      tradeDate > endDate
    ) {
      throw new Error(`Tushare USD/CNH returned invalid identity ${tsCode} ${tradeDate}`);
    }
    if (dates.has(tradeDate)) {
      throw new Error(`Tushare USD/CNH returned duplicate date ${tradeDate}`);
    }
    dates.add(tradeDate);
    const bar = {
      tsCode,
      tradeDate,
      exchange: FXCM_EXCHANGE,
      bidOpen: requiredNumber(row, 'bid_open'),
      bidClose: requiredNumber(row, 'bid_close'),
      bidHigh: requiredNumber(row, 'bid_high'),
      bidLow: requiredNumber(row, 'bid_low'),
      askOpen: requiredNumber(row, 'ask_open'),
      askClose: requiredNumber(row, 'ask_close'),
      askHigh: requiredNumber(row, 'ask_high'),
      askLow: requiredNumber(row, 'ask_low'),
      tickQty: requiredNumber(row, 'tick_qty'),
    };
    if (
      !Number.isInteger(bar.tickQty) ||
      bar.tickQty < 0 ||
      bar.bidLow <= 0 ||
      bar.askLow <= 0 ||
      bar.bidLow > bar.bidHigh ||
      bar.askLow > bar.askHigh ||
      bar.bidOpen > bar.askOpen ||
      bar.bidClose > bar.askClose ||
      bar.bidHigh > bar.askHigh ||
      bar.bidLow > bar.askLow
    ) {
      throw new Error(`Tushare USD/CNH returned invalid quotes on ${tradeDate}`);
    }
    bars.push(bar);
  }
  return bars.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

/** Maps a source-market date to the first later SSE session for China-close research. */
export function assignExternalAvailableDates<T extends { tradeDate: string }>(
  observations: T[],
  openDates: string[],
): Array<T & { availableDate: string }> {
  const sortedOpenDates = [...new Set(openDates)].sort();
  return observations.map((observation) => {
    const availableDate = sortedOpenDates.find((date) => date > observation.tradeDate);
    if (!availableDate) {
      throw new Error(`No later SSE trading day is available after ${observation.tradeDate}`);
    }
    return { ...observation, availableDate };
  });
}

/** Synchronize US nominal/real curves and USD/CNH with one auditable China-market PIT rule. */
export async function syncExternalMarketDrivers(
  client: ExternalMarketClient,
  startDate: string,
  endDate: string,
  onLog: (line: string) => void = console.log,
): Promise<ExternalMarketSyncSummary> {
  assertDateRange(startDate, endDate);
  const summary: ExternalMarketSyncSummary = {
    nominalCurvePoints: 0,
    realCurvePoints: 0,
    fxBars: 0,
  };
  for (const range of yearlyRanges(startDate, endDate)) {
    const [nominalRows, realRows, fxRows, calendarRows] = await Promise.all([
      client.call(
        'us_tycr',
        { start_date: range.startDate, end_date: range.endDate },
        NOMINAL_FIELDS,
      ),
      client.call(
        'us_trycr',
        { start_date: range.startDate, end_date: range.endDate },
        REAL_FIELDS,
      ),
      client.call(
        'fx_daily',
        { ts_code: USD_CNH_CODE, start_date: range.startDate, end_date: range.endDate },
        FX_FIELDS,
      ),
      prisma.tradeCal.findMany({
        where: {
          exchange: 'SSE',
          isOpen: 1,
          calDate: { gt: range.startDate, lte: addDays(range.endDate, 14) },
        },
        select: { calDate: true },
        orderBy: { calDate: 'asc' },
      }),
    ]);
    const openDates = calendarRows.map((row) => row.calDate);
    const nominal = assignExternalAvailableDates(
      parseExternalYieldCurveRows(nominalRows, 'nominal', range.startDate, range.endDate),
      openDates,
    );
    const real = assignExternalAvailableDates(
      parseExternalYieldCurveRows(realRows, 'real', range.startDate, range.endDate),
      openDates,
    );
    const fx = assignExternalAvailableDates(
      parseUsdCnhRows(fxRows, range.startDate, range.endDate),
      openDates,
    );
    const retrievedAt = new Date();
    await replaceCurveRange(
      US_NOMINAL_CURVE_CODE,
      US_NOMINAL_CURVE_NAME,
      range.startDate,
      range.endDate,
      nominal,
      retrievedAt,
    );
    await replaceCurveRange(
      US_REAL_CURVE_CODE,
      US_REAL_CURVE_NAME,
      range.startDate,
      range.endDate,
      real,
      retrievedAt,
    );
    if (fx.length > 0) {
      await prisma.$transaction([
        prisma.fxDaily.deleteMany({
          where: {
            tsCode: USD_CNH_CODE,
            tradeDate: { gte: range.startDate, lte: range.endDate },
          },
        }),
        prisma.fxDaily.createMany({ data: fx.map((bar) => ({ ...bar, retrievedAt })) }),
      ]);
    }
    summary.nominalCurvePoints += nominal.length;
    summary.realCurvePoints += real.length;
    summary.fxBars += fx.length;
    onLog(
      `External drivers ${range.startDate}..${range.endDate}: ${nominal.length} nominal points, ${real.length} real points, ${fx.length} USD/CNH bars`,
    );
  }
  return summary;
}

async function replaceCurveRange(
  curveCode: string,
  curveName: string,
  startDate: string,
  endDate: string,
  points: Array<ExternalYieldCurvePoint & { availableDate: string }>,
  retrievedAt: Date,
): Promise<void> {
  if (points.length === 0) {
    return;
  }
  await prisma.$transaction([
    prisma.yieldCurvePoint.deleteMany({
      where: {
        source: US_NOMINAL_CURVE_SOURCE,
        curveCode,
        curveType: US_TREASURY_CURVE_TYPE,
        tradeDate: { gte: startDate, lte: endDate },
      },
    }),
    prisma.yieldCurvePoint.createMany({
      data: points.map((point) => ({
        source: US_NOMINAL_CURVE_SOURCE,
        curveCode,
        curveName,
        curveType: US_TREASURY_CURVE_TYPE,
        ...point,
        retrievedAt,
      })),
    }),
  ]);
}

function yearlyRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    ranges.push({
      startDate: maximumDate(startDate, `${year}0101`),
      endDate: minimumDate(endDate, `${year}1231`),
    });
  }
  return ranges;
}

function requiredNumber(row: TushareRow, field: string): number {
  const value = numericField(row, field);
  if (value == null) {
    throw new Error(`Tushare external driver omitted ${field}`);
  }
  return value;
}

function numericField(row: TushareRow, field: string): number | null {
  const value = fieldValue(row, field);
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Tushare external driver returned non-numeric ${field}`);
  }
  return numeric;
}

function stringField(row: TushareRow, field: string): string {
  const value = fieldValue(row, field);
  return value == null ? '' : String(value).trim();
}

function fieldValue(row: TushareRow, field: string) {
  const matchingKey = Object.keys(row).find((key) => key.toLowerCase() === field.toLowerCase());
  return matchingKey ? row[matchingKey] : null;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
}

function isDate(value: string): boolean {
  return /^\d{8}$/.test(value);
}

function maximumDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minimumDate(left: string, right: string): string {
  return left <= right ? left : right;
}
