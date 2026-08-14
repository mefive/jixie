import { addDays } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import { macroVintageKind, type PreparedMacroObservation } from './china-macro.js';

export const US_HEADLINE_CPI_SERIES_KEY = 'us_cpi_u_all_items_nsa';
export const US_HEADLINE_CPI_BLS_SERIES_ID = 'CUUR0000SA0';

export const US_HEADLINE_CPI_SERIES = {
  seriesKey: US_HEADLINE_CPI_SERIES_KEY,
  nameZh: '美国城市消费者 CPI-U 全部项目（未经季调）',
  nameEn: 'US CPI-U All Items, Not Seasonally Adjusted',
  domain: 'inflation',
  frequency: 'monthly',
  unit: 'index_1982_1984_100',
  source: 'bls',
  sourceApi: 'bls_public_data_v2',
  sourceField: US_HEADLINE_CPI_BLS_SERIES_ID,
  defaultTransform: 'year_over_year',
  revisionPolicy: 'latest_value_with_captured_vintages',
} as const;

export interface BlsObservationRow {
  year: string;
  period: string;
  value: string;
}

export interface BlsPublicDataClientLike {
  loadSeries(seriesId: string, startYear: number, endYear: number): Promise<BlsObservationRow[]>;
}

export interface UsHeadlineCpiSyncSummary {
  series: 1;
  sourceRows: number;
  insertedVintages: number;
  unchangedObservations: number;
  deferredObservations: number;
}

interface NormalizedCpiObservation {
  period: string;
  value: number;
}

const BLS_PUBLIC_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const PUBLIC_API_MAX_YEARS = 10;
const CONSERVATIVE_RELEASE_LAG_DAYS = 20;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Minimal official BLS Public Data API client with a bounded request and strict response checks. */
export class BlsPublicDataClient implements BlsPublicDataClientLike {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async loadSeries(
    seriesId: string,
    startYear: number,
    endYear: number,
  ): Promise<BlsObservationRow[]> {
    if (endYear < startYear || endYear - startYear + 1 > PUBLIC_API_MAX_YEARS) {
      throw new Error('BLS public requests must cover between 1 and 10 inclusive calendar years');
    }
    const response = await this.fetchImpl(BLS_PUBLIC_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seriesid: [seriesId],
        startyear: String(startYear),
        endyear: String(endYear),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`BLS Public Data API returned HTTP ${response.status}`);
    }
    return parseBlsResponse(await response.json(), seriesId);
  }
}

/** Builds non-overlapping public-API ranges that never exceed BLS's unregistered 10-year limit. */
export function blsYearRanges(
  startMonth: string,
  endMonth: string,
): Array<{ startYear: number; endYear: number }> {
  assertMonthRange(startMonth, endMonth);
  const ranges: Array<{ startYear: number; endYear: number }> = [];
  const finalYear = Number(endMonth.slice(0, 4));
  for (let startYear = Number(startMonth.slice(0, 4)); startYear <= finalYear; ) {
    const endYear = Math.min(startYear + PUBLIC_API_MAX_YEARS - 1, finalYear);
    ranges.push({ startYear, endYear });
    startYear = endYear + 1;
  }
  return ranges;
}

/** Normalizes the BLS monthly index and skips annual averages or explicitly unavailable values. */
export function parseUsHeadlineCpiRows(
  rows: BlsObservationRow[],
  startMonth: string,
  endMonth: string,
): NormalizedCpiObservation[] {
  assertMonthRange(startMonth, endMonth);
  const observations = new Map<string, NormalizedCpiObservation>();
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.year) || !/^M(?:0[1-9]|1[0-3])$/.test(row.period)) {
      throw new Error(`BLS CPI returned an invalid period ${row.year} ${row.period}`);
    }
    if (row.period === 'M13') {
      continue;
    }
    const period = `${row.year}${row.period.slice(1)}`;
    if (period < startMonth || period > endMonth) {
      continue;
    }
    if (observations.has(period)) {
      throw new Error(`BLS CPI returned duplicate period ${period}`);
    }
    if (row.value === '-') {
      continue;
    }
    const value = Number(row.value);
    if (!Number.isFinite(value) || value <= 0 || value >= 1_000) {
      throw new Error(`BLS CPI returned an invalid value for ${period}`);
    }
    observations.set(period, { period, value });
  }
  return [...observations.values()].sort((left, right) => left.period.localeCompare(right.period));
}

/** Assigns a deliberately conservative China-close availability date to BLS historical values. */
export function prepareUsHeadlineCpiObservations(
  observations: NormalizedCpiObservation[],
  openDates: string[],
): PreparedMacroObservation[] {
  const sortedOpenDates = [...new Set(openDates)].sort();
  return observations.map((observation) => {
    const availabilityAnchor = addDays(monthEnd(observation.period), CONSERVATIVE_RELEASE_LAG_DAYS);
    const availableDate = sortedOpenDates.find((date) => date >= availabilityAnchor);
    if (!availableDate) {
      throw new Error(
        `TradeCal has no SSE open date on or after ${availabilityAnchor} for ${US_HEADLINE_CPI_SERIES_KEY} ${observation.period}`,
      );
    }
    return {
      seriesKey: US_HEADLINE_CPI_SERIES_KEY,
      period: observation.period,
      value: observation.value,
      releaseDate: null,
      availableDate,
      availabilityKind: 'conservative_lag',
    };
  });
}

/** Syncs BLS headline CPI levels while preserving corrections as explicit captured vintages. */
export async function syncUsHeadlineCpiData(
  client: BlsPublicDataClientLike,
  startMonth: string,
  endMonth: string,
  onLog: (line: string) => void = console.log,
  retrievedAt = new Date(),
): Promise<UsHeadlineCpiSyncSummary> {
  assertMonthRange(startMonth, endMonth);
  const rows: BlsObservationRow[] = [];
  for (const range of blsYearRanges(startMonth, endMonth)) {
    rows.push(
      ...(await client.loadSeries(US_HEADLINE_CPI_BLS_SERIES_ID, range.startYear, range.endYear)),
    );
  }
  const normalized = parseUsHeadlineCpiRows(rows, startMonth, endMonth);
  const openDates = await loadOpenDates(startMonth, endMonth);
  const prepared = prepareUsHeadlineCpiObservations(normalized, openDates);
  const vintageDate = shanghaiDate(retrievedAt);
  const ready = prepared.filter((observation) => observation.availableDate <= vintageDate);

  await prisma.macroSeries.upsert({
    where: { seriesKey: US_HEADLINE_CPI_SERIES_KEY },
    create: US_HEADLINE_CPI_SERIES,
    update: US_HEADLINE_CPI_SERIES,
  });
  const existing = await prisma.macroObservation.findMany({
    where: { seriesKey: US_HEADLINE_CPI_SERIES_KEY },
    orderBy: [{ period: 'asc' }, { vintageDate: 'desc' }],
  });
  const latestByPeriod = new Map<string, (typeof existing)[number]>();
  for (const observation of existing) {
    if (!latestByPeriod.has(observation.period)) {
      latestByPeriod.set(observation.period, observation);
    }
  }
  const changed = ready.filter((observation) => {
    const current = latestByPeriod.get(observation.period);
    return !current || !sameObservation(current, observation);
  });
  for (let offset = 0; offset < changed.length; offset += 500) {
    const batch = changed.slice(offset, offset + 500);
    await prisma.$transaction(
      batch.map((observation) =>
        prisma.macroObservation.upsert({
          where: {
            seriesKey_period_vintageDate: {
              seriesKey: observation.seriesKey,
              period: observation.period,
              vintageDate,
            },
          },
          create: {
            ...observation,
            vintageDate,
            vintageKind: macroVintageKind(observation.availableDate, vintageDate),
            retrievedAt,
          },
          update: {
            ...observation,
            vintageKind: macroVintageKind(observation.availableDate, vintageDate),
            retrievedAt,
          },
        }),
      ),
    );
  }

  const summary: UsHeadlineCpiSyncSummary = {
    series: 1,
    sourceRows: rows.length,
    insertedVintages: changed.length,
    unchangedObservations: ready.length - changed.length,
    deferredObservations: prepared.length - ready.length,
  };
  onLog(
    `US headline CPI ${startMonth}..${endMonth}: ${summary.insertedVintages} vintages inserted, ${summary.unchangedObservations} unchanged, ${summary.deferredObservations} deferred`,
  );
  return summary;
}

function parseBlsResponse(value: unknown, seriesId: string): BlsObservationRow[] {
  if (!isObject(value) || value.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS Public Data API request failed: ${responseMessages(value).join('; ')}`);
  }
  const results = value.Results;
  if (!isObject(results) || !Array.isArray(results.series) || results.series.length !== 1) {
    throw new Error('BLS Public Data API returned an invalid series collection');
  }
  const series = results.series[0];
  if (!isObject(series) || series.seriesID !== seriesId || !Array.isArray(series.data)) {
    throw new Error(`BLS Public Data API did not return the requested series ${seriesId}`);
  }
  return series.data.map((row) => {
    if (
      !isObject(row) ||
      typeof row.year !== 'string' ||
      typeof row.period !== 'string' ||
      typeof row.value !== 'string'
    ) {
      throw new Error('BLS Public Data API returned an invalid observation row');
    }
    return { year: row.year, period: row.period, value: row.value };
  });
}

function responseMessages(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.message)) {
    return ['unknown response'];
  }
  return value.message.filter((message): message is string => typeof message === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function loadOpenDates(startMonth: string, endMonth: string): Promise<string[]> {
  const rows = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: {
        gte: `${startMonth}01`,
        lte: addDays(monthEnd(endMonth), 40),
      },
    },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  return rows.map((row) => row.calDate);
}

function sameObservation(
  existing: {
    value: number;
    releaseDate: string | null;
    availableDate: string;
    availabilityKind: string;
  },
  candidate: PreparedMacroObservation,
): boolean {
  return (
    existing.value === candidate.value &&
    existing.releaseDate === candidate.releaseDate &&
    existing.availableDate === candidate.availableDate &&
    existing.availabilityKind === candidate.availabilityKind
  );
}

function shanghaiDate(value: Date): string {
  const parts = Object.fromEntries(
    SHANGHAI_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

function monthEnd(month: string): string {
  const value = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)), 0));
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

function assertMonthRange(startMonth: string, endMonth: string): void {
  const valid = (month: string) =>
    /^\d{6}$/.test(month) && Number(month.slice(4, 6)) >= 1 && Number(month.slice(4, 6)) <= 12;
  if (!valid(startMonth) || !valid(endMonth) || startMonth > endMonth) {
    throw new Error('start/end must be YYYYMM and start must not exceed end');
  }
}
