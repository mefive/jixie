import { prisma } from '#infra/database/prisma.js';
import {
  CHINA_TREASURY_CURVE_SOURCE,
  CHINA_TREASURY_CURVE_CODE,
  CHINA_TREASURY_CURVE_NAME,
  CHINA_TREASURY_CURVE_TYPE,
  CHINA_TREASURY_TERMS,
} from '../registry/yield-curves.js';

const SOURCE_ENDPOINT = 'https://yield.chinabond.com.cn/cbweb-czb-web/czb/czbQueryYz';
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 声明国债曲线来源序列与期限身份。
 * Identify government-curve source series and tenors.
 */
interface ChinaTreasuryCurveSeries {
  ycDefId: string;
  ycDefName: string;
  seriesData: Array<[number, number]>;
  dcq: number;
}

/**
 * 保留官方国债曲线的实际发布点。
 * Describe actually published government-curve points.
 */
export interface ChinaTreasuryCurvePoint {
  tradeDate: string;
  termYears: number;
  yieldPct: number;
}

/**
 * 为官方曲线点附加中国市场可得日。
 * Associate official curve points with China-market availability.
 */
export interface AvailableChinaTreasuryCurvePoint extends ChinaTreasuryCurvePoint {
  availableDate: string;
}

/**
 * 隔离官方国债来源获取，供同步与验证。
 * Abstract official government-curve fetching for synchronization.
 */
export interface ChinaTreasuryCurveClient {
  fetchRange(startDate: string, endDate: string): Promise<ChinaTreasuryCurvePoint[]>;
}

/** Official Ministry of Finance curve source exposed by the ChinaBond-hosted public page. */
export class MinistryOfFinanceCurveClient implements ChinaTreasuryCurveClient {
  public constructor(
    private readonly timeoutMs = 30_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * 按日期范围获取官方国债曲线，供完整期限校验。
   * Fetch official government curves over a bounded date range.
   */
  public async fetchRange(startDate: string, endDate: string): Promise<ChinaTreasuryCurvePoint[]> {
    assertDateRange(startDate, endDate);
    const parameters = new URLSearchParams({
      zblx: 'yz',
      gjqx: CHINA_TREASURY_TERMS.join(','),
      startTime: displayDate(startDate),
      endTime: displayDate(endDate),
      locale: 'cn_ZH',
      qxmc: '1',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${SOURCE_ENDPOINT}?${parameters}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'user-agent': 'jixie-research/1.0 (source attribution: Ministry of Finance China)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`China treasury curve source returned HTTP ${response.status}`);
      }
      return parseChinaTreasuryCurveResponse(await response.json(), startDate, endDate);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * 校验并解析财政部国债曲线响应，保留实际发布期限。
 * Validate and parse official government curve responses without inventing term points.
 */
export function parseChinaTreasuryCurveResponse(
  value: unknown,
  startDate: string,
  endDate: string,
): ChinaTreasuryCurvePoint[] {
  if (!Array.isArray(value)) {
    throw new Error('China treasury curve source returned a non-array payload');
  }
  const terms = new Set<number>(CHINA_TREASURY_TERMS);
  const points: ChinaTreasuryCurvePoint[] = [];
  const identities = new Set<string>();
  for (const rawSeries of value) {
    const series = rawSeries as Partial<ChinaTreasuryCurveSeries>;
    if (!Number.isFinite(series.dcq) || !terms.has(series.dcq!)) {
      throw new Error('China treasury curve source returned an unknown maturity');
    }
    if (!Array.isArray(series.seriesData)) {
      throw new Error(`China treasury curve source omitted series data for ${series.dcq}Y`);
    }
    for (const observation of series.seriesData) {
      if (
        !Array.isArray(observation) ||
        !Number.isFinite(observation[0]) ||
        !Number.isFinite(observation[1]) ||
        observation[1] <= 0 ||
        observation[1] >= 20
      ) {
        throw new Error(`China treasury curve source returned an invalid ${series.dcq}Y point`);
      }
      const tradeDate = chinaCalendarDate(observation[0]);
      if (tradeDate < startDate || tradeDate > endDate) {
        throw new Error(`China treasury curve source returned out-of-range date ${tradeDate}`);
      }
      const identity = `${tradeDate}:${series.dcq}`;
      if (identities.has(identity)) {
        throw new Error(`China treasury curve source returned duplicate point ${identity}`);
      }
      identities.add(identity);
      points.push({ tradeDate, termYears: series.dcq!, yieldPct: observation[1] });
    }
  }
  return validateCompleteDates(points);
}

export function assignCurveAvailableDates<T extends ChinaTreasuryCurvePoint>(
  points: T[],
  openDates: string[],
): Array<T & { availableDate: string }> {
  const sortedOpenDates = [...new Set(openDates)].sort();
  return points.map((point) => {
    const availableDate = sortedOpenDates.find((date) => date > point.tradeDate);
    if (!availableDate) {
      throw new Error(`No next SSE trading day is available after curve date ${point.tradeDate}`);
    }
    return { ...point, availableDate };
  });
}

/**
 * 分段同步国债收益率及可得日期，供研究和信号利率读取。
 * Synchronize government yields and availability dates for research and signal reads.
 */
export async function syncChinaTreasuryYieldCurve(
  client: ChinaTreasuryCurveClient,
  startDate: string,
  endDate: string,
  onLog: (line: string) => void = console.log,
): Promise<number> {
  assertDateRange(startDate, endDate);
  let total = 0;
  for (const range of yearlyRanges(startDate, endDate)) {
    const points = await client.fetchRange(range.startDate, range.endDate);
    if (points.length === 0) {
      onLog(`China treasury curve ${range.startDate}..${range.endDate}: no observations`);
      continue;
    }
    const openDates = await prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gt: range.startDate, lte: addCalendarDays(range.endDate, 14) },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    });
    const available = assignCurveAvailableDates(
      points,
      openDates.map((row) => row.calDate),
    );
    const retrievedAt = new Date();
    await prisma.$transaction([
      prisma.yieldCurvePoint.deleteMany({
        where: {
          source: CHINA_TREASURY_CURVE_SOURCE,
          curveCode: CHINA_TREASURY_CURVE_CODE,
          curveType: CHINA_TREASURY_CURVE_TYPE,
          tradeDate: { gte: range.startDate, lte: range.endDate },
        },
      }),
      prisma.yieldCurvePoint.createMany({
        data: available.map((point) => ({
          source: CHINA_TREASURY_CURVE_SOURCE,
          curveCode: CHINA_TREASURY_CURVE_CODE,
          curveName: CHINA_TREASURY_CURVE_NAME,
          curveType: CHINA_TREASURY_CURVE_TYPE,
          ...point,
          retrievedAt,
        })),
      }),
    ]);
    total += available.length;
    onLog(`China treasury curve ${range.startDate}..${range.endDate}: ${available.length} points`);
  }
  return total;
}

/**
 * 验证每个日期所需曲线期限齐全，避免部分曲线静默发布。
 * Validate required terms for each date before publishing a curve slice.
 */
function validateCompleteDates(points: ChinaTreasuryCurvePoint[]): ChinaTreasuryCurvePoint[] {
  const termsByDate = new Map<string, Set<number>>();
  for (const point of points) {
    const dateTerms = termsByDate.get(point.tradeDate) ?? new Set<number>();
    dateTerms.add(point.termYears);
    termsByDate.set(point.tradeDate, dateTerms);
  }
  for (const [tradeDate, terms] of termsByDate) {
    if (terms.size !== CHINA_TREASURY_TERMS.length) {
      throw new Error(
        `China treasury curve date ${tradeDate} has ${terms.size}/${CHINA_TREASURY_TERMS.length} maturities`,
      );
    }
  }
  return points.sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) || left.termYears - right.termYears,
  );
}

/**
 * 按年度切分国债曲线请求，限制来源区间。
 * Split government-curve requests into calendar-year ranges.
 */
function yearlyRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    ranges.push({
      startDate: year === Number(startDate.slice(0, 4)) ? startDate : `${year}0101`,
      endDate: year === Number(endDate.slice(0, 4)) ? endDate : `${year}1231`,
    });
  }
  return ranges;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
}

function chinaCalendarDate(timestamp: number): string {
  const parts = Object.fromEntries(
    CHINA_DATE_FORMATTER.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

function displayDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}
