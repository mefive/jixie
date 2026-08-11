import { strFromU8, unzipSync } from 'fflate';
import { prisma } from '../lib/prisma.js';
import { assignCurveAvailableDates } from './china-treasury-curve.js';

export const CHINABOND_PUBLIC_CURVE_SOURCE = 'chinabond_pbc_public';
export const CHINABOND_PUBLIC_CURVE_TYPE = 'ytm';

export const CHINABOND_PUBLIC_CURVES = [
  {
    curveCode: 'chinabond_cgb_ytm',
    curveName: '中债国债收益率曲线',
  },
  {
    curveCode: 'chinabond_bank_aaa_ytm',
    curveName: '中债商业银行普通债收益率曲线(AAA)',
  },
  {
    curveCode: 'chinabond_cp_note_aaa_ytm',
    curveName: '中债中短期票据收益率曲线(AAA)',
  },
] as const;

const HISTORY_ENDPOINT = 'https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyDown';
const CURVE_CODE_BY_NAME = new Map<string, ChinaBondCreditCurvePoint['curveCode']>(
  CHINABOND_PUBLIC_CURVES.map((curve) => [curve.curveName, curve.curveCode]),
);
const TERM_BY_HEADER = new Map([
  ['3月', 0.25],
  ['6月', 0.5],
  ['1年', 1],
  ['3年', 3],
  ['5年', 5],
  ['7年', 7],
  ['10年', 10],
  ['30年', 30],
]);

export interface ChinaBondCreditCurvePoint {
  curveCode: (typeof CHINABOND_PUBLIC_CURVES)[number]['curveCode'];
  curveName: (typeof CHINABOND_PUBLIC_CURVES)[number]['curveName'];
  tradeDate: string;
  termYears: number;
  yieldPct: number;
}

export interface ChinaBondCreditCurveClient {
  fetchRange(startDate: string, endDate: string): Promise<ChinaBondCreditCurvePoint[]>;
}

/** Official ChinaBond public history download used by the PBC-hosted yield-curve page. */
export class ChinaBondPublicCurveClient implements ChinaBondCreditCurveClient {
  public constructor(
    private readonly timeoutMs = 60_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async fetchRange(
    startDate: string,
    endDate: string,
  ): Promise<ChinaBondCreditCurvePoint[]> {
    assertDateRange(startDate, endDate);
    const parameters = new URLSearchParams({
      startDate: displayDate(startDate),
      endDate: displayDate(endDate),
      gjqx: '0',
      qxId: 'ycqx',
      locale: 'cn_ZH',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${HISTORY_ENDPOINT}?${parameters}`, {
        headers: {
          accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'user-agent': 'jixie-research/1.0 (source attribution: ChinaBond)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ChinaBond public curve source returned HTTP ${response.status}`);
      }
      return parseChinaBondCurveWorkbook(
        new Uint8Array(await response.arrayBuffer()),
        startDate,
        endDate,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Parse the source workbook and preserve only actual published term points. */
export function parseChinaBondCurveWorkbook(
  workbook: Uint8Array,
  startDate: string,
  endDate: string,
): ChinaBondCreditCurvePoint[] {
  assertDateRange(startDate, endDate);
  if (workbook.byteLength > 20_000_000) {
    throw new Error('ChinaBond public curve workbook exceeds the 20 MB safety limit');
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(workbook);
  } catch {
    throw new Error('ChinaBond public curve source returned an invalid XLSX archive');
  }
  const sheetBytes = files['xl/worksheets/sheet1.xml'];
  if (!sheetBytes) {
    throw new Error('ChinaBond public curve workbook omitted sheet1.xml');
  }
  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']);
  const rows = parseSheetRows(strFromU8(sheetBytes), sharedStrings);
  const header = rows[0];
  if (header?.A !== '曲线名称' || header.B !== '日期') {
    throw new Error('ChinaBond public curve workbook has an unknown header');
  }
  const termsByColumn = new Map<string, number>();
  for (const [column, value] of Object.entries(header)) {
    const termYears = TERM_BY_HEADER.get(value);
    if (termYears != null) {
      termsByColumn.set(column, termYears);
    }
  }
  if (termsByColumn.size !== TERM_BY_HEADER.size) {
    throw new Error(
      `ChinaBond public curve workbook has ${termsByColumn.size}/${TERM_BY_HEADER.size} expected terms`,
    );
  }

  const identities = new Set<string>();
  const points: ChinaBondCreditCurvePoint[] = [];
  for (const row of rows.slice(1)) {
    const curveName = row.A;
    const curveCode = CURVE_CODE_BY_NAME.get(curveName);
    if (!curveCode) {
      continue;
    }
    const tradeDate = normalizeSourceDate(row.B);
    if (tradeDate < startDate || tradeDate > endDate) {
      throw new Error(`ChinaBond public curve source returned out-of-range date ${tradeDate}`);
    }
    for (const [column, termYears] of termsByColumn) {
      const rawYield = row[column]?.trim();
      if (!rawYield) {
        continue;
      }
      const yieldPct = Number(rawYield);
      if (!Number.isFinite(yieldPct) || yieldPct <= -10 || yieldPct >= 30) {
        throw new Error(
          `ChinaBond public curve source returned invalid ${termYears}Y yield on ${tradeDate}`,
        );
      }
      const identity = `${curveCode}|${tradeDate}|${termYears}`;
      if (identities.has(identity)) {
        throw new Error(`ChinaBond public curve source returned duplicate point ${identity}`);
      }
      identities.add(identity);
      points.push({
        curveCode,
        curveName: curveName as ChinaBondCreditCurvePoint['curveName'],
        tradeDate,
        termYears,
        yieldPct,
      });
    }
  }
  if (rows.length > 1 && points.length === 0) {
    throw new Error('ChinaBond public curve workbook contains no recognized curve observations');
  }
  if (startDate >= '20100101' && points.length > 0) {
    const observedCurves = new Set(points.map((point) => point.curveCode));
    const missingCurves = CHINABOND_PUBLIC_CURVES.filter(
      (curve) => !observedCurves.has(curve.curveCode),
    );
    if (missingCurves.length > 0) {
      throw new Error(
        `ChinaBond public curve workbook omitted required curves: ${missingCurves.map((curve) => curve.curveCode).join(', ')}`,
      );
    }
  }
  return points.sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) ||
      left.curveCode.localeCompare(right.curveCode) ||
      left.termYears - right.termYears,
  );
}

/**
 * Replace one successfully downloaded calendar-year slice. ChinaBond publishes these curves
 * after the China close, so each observation is gated to the first strictly later SSE session.
 */
export async function syncChinaBondCreditCurves(
  client: ChinaBondCreditCurveClient,
  startDate: string,
  endDate: string,
  onLog: (line: string) => void = console.log,
): Promise<number> {
  assertDateRange(startDate, endDate);
  let total = 0;
  for (const range of yearlyRanges(startDate, endDate)) {
    const points = await client.fetchRange(range.startDate, range.endDate);
    if (points.length === 0) {
      onLog(`ChinaBond public curves ${range.startDate}..${range.endDate}: no observations`);
      continue;
    }
    const calendarRows = await prisma.tradeCal.findMany({
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
      calendarRows.map((row) => row.calDate),
    );
    const retrievedAt = new Date();
    await prisma.$transaction([
      prisma.yieldCurvePoint.deleteMany({
        where: {
          source: CHINABOND_PUBLIC_CURVE_SOURCE,
          curveCode: { in: CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode) },
          curveType: CHINABOND_PUBLIC_CURVE_TYPE,
          tradeDate: { gte: range.startDate, lte: range.endDate },
        },
      }),
      prisma.yieldCurvePoint.createMany({
        data: available.map((point) => ({
          source: CHINABOND_PUBLIC_CURVE_SOURCE,
          curveType: CHINABOND_PUBLIC_CURVE_TYPE,
          ...point,
          retrievedAt,
        })),
      }),
    ]);
    total += available.length;
    onLog(
      `ChinaBond public curves ${range.startDate}..${range.endDate}: ${available.length} points`,
    );
  }
  return total;
}

function parseSharedStrings(bytes: Uint8Array | undefined): string[] {
  if (!bytes) {
    return [];
  }
  return [...strFromU8(bytes).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    parseTextNodes(match[1]),
  );
}

function parseSheetRows(xml: string, sharedStrings: string[]): Array<Record<string, string>> {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row: Record<string, string> = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = /\br="([A-Z]+)\d+"/.exec(cellMatch[1])?.[1];
      if (!reference) {
        continue;
      }
      const type = /\bt="([^"]+)"/.exec(cellMatch[1])?.[1];
      const body = cellMatch[2];
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
        row[reference] = Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
      } else if (type === 'inlineStr') {
        row[reference] = parseTextNodes(body);
      } else {
        row[reference] = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
    }
    return row;
  });
}

function parseTextNodes(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function normalizeSourceDate(value: string): string {
  const normalized = value.trim().replaceAll('-', '');
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error(`ChinaBond public curve source returned invalid date ${value}`);
  }
  return normalized;
}

function yearlyRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    ranges.push({
      startDate: startDate > `${year}0101` ? startDate : `${year}0101`,
      endDate: endDate < `${year}1231` ? endDate : `${year}1231`,
    });
  }
  return ranges;
}

function assertDateRange(startDate: string, endDate: string): void {
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || startDate > endDate) {
    throw new Error('start/end must be YYYYMMDD and start must not exceed end');
  }
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
