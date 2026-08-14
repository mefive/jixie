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
  sourceApi: 'bls_public_data_api_or_bulk_or_oecd_sdmx_or_fred_graph_csv',
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
const BLS_ALL_ITEMS_BULK_URL = 'https://download.bls.gov/pub/time.series/cu/cu.data.1.AllItems';
const OECD_US_CPI_URL =
  'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/USA.M.N.CPI.IX._T.N._Z?startPeriod=2005-01&dimensionAtObservation=AllDimensions&format=csvfilewithlabels';
const FRED_US_CPI_GRAPH_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS';
const FRED_US_CPI_SERIES_ID = 'CPIAUCNS';
const OECD_US_CPI_SERIES_PATH = 'USA.M.N.CPI.IX._T.N._Z';
const OECD_US_CPI_BASE_PERIOD = '2015';
// Annual average of BLS CUUR0000SA0 in 2015, used to restore OECD's rebased 2015=100 index.
const BLS_US_CPI_2015_ANNUAL_AVERAGE = 237.017;
// BLS did not publish the all-items October 2025 index after the US funding lapse.
const BLS_US_CPI_INTENTIONALLY_UNPUBLISHED_PERIODS = new Set(['2025-10']);
const BLS_REQUEST_HEADERS = {
  accept: 'application/json, text/plain;q=0.9',
  'user-agent': 'jixie-research/1.0 (+https://github.com/mefive/jixie)',
} as const;
const OECD_RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const OECD_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const OECD_MAX_ATTEMPTS = OECD_RETRY_DELAYS_MS.length + 1;
const PUBLIC_API_MAX_YEARS = 10;
const CONSERVATIVE_RELEASE_LAG_DAYS = 20;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Official BLS client with bounded API requests and official-source fallbacks.
 *
 * BLS publishes an unregistered single-series GET signature as well as the multi-series POST
 * signature. The GET form is preferred because some gateways reject the POST form with HTTP 403.
 * If one API form is unavailable, the client tries the other before downloading and caching the
 * official All Items bulk file for the rest of the process. If all BLS delivery domains are
 * blocked, the client uses OECD's exact national, monthly, all-items, non-seasonally-adjusted CPI
 * series and restores its 2015=100 values to BLS's native 1982-84=100 scale. Transient OECD
 * failures are retried before FRED's exact CPIAUCNS graph export is used as the final fallback.
 */
export class BlsPublicDataClient implements BlsPublicDataClientLike {
  private getApiFailure: Error | null = null;
  private postApiFailure: Error | null = null;
  private bulkFailure: Error | null = null;
  private oecdFailure: Error | null = null;
  private bulkTextPromise: Promise<string> | null = null;
  private oecdRowsPromise: Promise<BlsObservationRow[]> | null = null;
  private fredRowsPromise: Promise<BlsObservationRow[]> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onLog: (line: string) => void = console.warn,
    private readonly now: () => Date = () => new Date(),
    private readonly delay: (milliseconds: number) => Promise<void> = sleep,
  ) {}

  async loadSeries(
    seriesId: string,
    startYear: number,
    endYear: number,
  ): Promise<BlsObservationRow[]> {
    if (endYear < startYear || endYear - startYear + 1 > PUBLIC_API_MAX_YEARS) {
      throw new Error('BLS public requests must cover between 1 and 10 inclusive calendar years');
    }

    if (!this.getApiFailure) {
      try {
        return await this.loadGetApiSeries(seriesId, startYear, endYear);
      } catch (error) {
        this.getApiFailure = asError(error);
        this.onLog(
          `BLS GET API unavailable (${this.getApiFailure.message}); trying the official POST API`,
        );
      }
    }

    if (!this.postApiFailure) {
      try {
        return await this.loadPostApiSeries(seriesId, startYear, endYear);
      } catch (error) {
        this.postApiFailure = asError(error);
        this.onLog(
          `BLS POST API unavailable (${this.postApiFailure.message}); falling back to the official All Items bulk file`,
        );
      }
    }

    if (!this.bulkFailure) {
      try {
        const rows = await this.loadBulkRows(seriesId);
        return rows.filter((row) => Number(row.year) >= startYear && Number(row.year) <= endYear);
      } catch (error) {
        this.bulkFailure = asError(error);
        this.onLog(
          `BLS bulk download unavailable (${this.bulkFailure.message}); falling back to OECD national CPI SDMX`,
        );
      }
    }

    if (!this.oecdFailure) {
      try {
        const rows = await this.loadOecdRows(seriesId);
        return rows.filter((row) => Number(row.year) >= startYear && Number(row.year) <= endYear);
      } catch (error) {
        this.oecdFailure = asError(error);
        this.onLog(
          `OECD US CPI unavailable (${this.oecdFailure.message}); falling back to FRED ${FRED_US_CPI_SERIES_ID} graph CSV`,
        );
      }
    }

    try {
      const rows = await this.loadFredRows(seriesId);
      return rows.filter((row) => Number(row.year) >= startYear && Number(row.year) <= endYear);
    } catch (error) {
      throw new Error(
        `BLS CPI retrieval failed: GET API: ${this.getApiFailure?.message ?? 'not attempted'}; POST API: ${this.postApiFailure?.message ?? 'not attempted'}; bulk: ${this.bulkFailure?.message ?? 'not attempted'}; OECD: ${this.oecdFailure?.message ?? 'not attempted'}; FRED: ${asError(error).message}`,
      );
    }
  }

  private async loadGetApiSeries(
    seriesId: string,
    startYear: number,
    endYear: number,
  ): Promise<BlsObservationRow[]> {
    const url = new URL(`${BLS_PUBLIC_API_URL}${encodeURIComponent(seriesId)}`);
    url.searchParams.set('startyear', String(startYear));
    url.searchParams.set('endyear', String(endYear));
    const response = await this.fetchImpl(url, {
      headers: BLS_REQUEST_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`returned HTTP ${response.status}`);
    }
    return parseBlsResponse(await response.json(), seriesId);
  }

  private async loadPostApiSeries(
    seriesId: string,
    startYear: number,
    endYear: number,
  ): Promise<BlsObservationRow[]> {
    const response = await this.fetchImpl(BLS_PUBLIC_API_URL, {
      method: 'POST',
      headers: { ...BLS_REQUEST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        seriesid: [seriesId],
        startyear: String(startYear),
        endyear: String(endYear),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`returned HTTP ${response.status}`);
    }
    return parseBlsResponse(await response.json(), seriesId);
  }

  private loadBulkRows(seriesId: string): Promise<BlsObservationRow[]> {
    this.bulkTextPromise ??= this.fetchImpl(BLS_ALL_ITEMS_BULK_URL, {
      headers: BLS_REQUEST_HEADERS,
      signal: AbortSignal.timeout(60_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`official All Items file returned HTTP ${response.status}`);
      }
      return response.text();
    });
    return this.bulkTextPromise.then((value) => parseBlsBulkFile(value, seriesId));
  }

  private loadOecdRows(seriesId: string): Promise<BlsObservationRow[]> {
    if (seriesId !== US_HEADLINE_CPI_BLS_SERIES_ID) {
      return Promise.reject(
        new Error(`OECD fallback does not represent the requested BLS series ${seriesId}`),
      );
    }
    this.oecdRowsPromise ??= this.loadOecdText().then((value) => {
      const rows = parseOecdUsCpiCsv(value, minimumRecentCpiPeriod(this.now()));
      const first = rows[0];
      if (first?.year !== '2005' || first.period !== 'M01') {
        throw new Error('official SDMX series did not start at the requested period 2005-01');
      }
      const last = rows.at(-1);
      this.onLog(
        `OECD US CPI fallback loaded ${rows.length} monthly observations (200501..${last?.year}${last?.period.slice(1)})`,
      );
      return rows;
    });
    return this.oecdRowsPromise;
  }

  private async loadOecdText(): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= OECD_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchImpl(OECD_US_CPI_URL, {
          headers: {
            accept: 'text/csv',
            // Avoid OECD edge nodes that reject Undici's default `Accept-Language: *`.
            'accept-language': 'en',
            'user-agent': BLS_REQUEST_HEADERS['user-agent'],
          },
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) {
          return response.text();
        }
        const detail = await response.text();
        const statusError = new HttpStatusError(
          response.status,
          `official SDMX endpoint returned HTTP ${response.status}${httpBodySuffix(detail)}`,
        );
        if (!OECD_RETRYABLE_HTTP_STATUSES.has(response.status)) {
          throw statusError;
        }
        lastError = statusError;
      } catch (error) {
        if (error instanceof HttpStatusError && !OECD_RETRYABLE_HTTP_STATUSES.has(error.status)) {
          throw error;
        }
        lastError = asError(error);
      }

      if (attempt === OECD_MAX_ATTEMPTS) {
        break;
      }
      const delayMilliseconds = OECD_RETRY_DELAYS_MS[attempt - 1]!;
      this.onLog(
        `OECD US CPI attempt ${attempt}/${OECD_MAX_ATTEMPTS} failed (${lastError.message}); retrying in ${delayMilliseconds}ms`,
      );
      await this.delay(delayMilliseconds);
    }
    throw lastError ?? new Error('official SDMX endpoint failed without an error');
  }

  private loadFredRows(seriesId: string): Promise<BlsObservationRow[]> {
    if (seriesId !== US_HEADLINE_CPI_BLS_SERIES_ID) {
      return Promise.reject(
        new Error(`FRED fallback does not represent the requested BLS series ${seriesId}`),
      );
    }
    this.fredRowsPromise ??= this.fetchImpl(FRED_US_CPI_GRAPH_URL, {
      headers: {
        accept: 'text/csv',
        'user-agent': BLS_REQUEST_HEADERS['user-agent'],
      },
      signal: AbortSignal.timeout(60_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`graph CSV endpoint returned HTTP ${response.status}`);
      }
      const rows = parseFredUsCpiCsv(await response.text(), minimumRecentCpiPeriod(this.now()));
      if (!rows.some((row) => row.year === '2005' && row.period === 'M01')) {
        throw new Error('graph CSV series did not contain the required period 2005-01');
      }
      const first = rows[0];
      const last = rows.at(-1);
      this.onLog(
        `FRED ${FRED_US_CPI_SERIES_ID} fallback loaded ${rows.length} monthly observations (${first?.year}${first?.period.slice(1)}..${last?.year}${last?.period.slice(1)})`,
      );
      return rows;
    });
    return this.fredRowsPromise;
  }
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const OECD_REQUIRED_DIMENSIONS = {
  REF_AREA: 'USA',
  FREQ: 'M',
  METHODOLOGY: 'N',
  MEASURE: 'CPI',
  UNIT_MEASURE: 'IX',
  EXPENDITURE: '_T',
  ADJUSTMENT: 'N',
  TRANSFORMATION: '_Z',
  BASE_PER: OECD_US_CPI_BASE_PERIOD,
} as const;

/**
 * Parses OECD's exact US CPI SDMX series and restores BLS's native 1982-84=100 scale.
 *
 * OECD rebases the same national CPI observations to 2015=100, so the conversion uses BLS's
 * published 2015 annual average. Dimensions, base period, duplicates, undocumented gaps and
 * freshness are all checked before any values are accepted.
 */
export function parseOecdUsCpiCsv(value: string, minimumRecentPeriod: string): BlsObservationRow[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(minimumRecentPeriod)) {
    throw new Error(`Invalid OECD CPI freshness period ${minimumRecentPeriod}`);
  }
  const csvRows = parseCsvRows(value);
  const headers = csvRows[0];
  if (!headers) {
    throw new Error('OECD CPI SDMX response was empty');
  }
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [...Object.keys(OECD_REQUIRED_DIMENSIONS), 'TIME_PERIOD', 'OBS_VALUE'];
  for (const header of requiredHeaders) {
    if (!headerIndexes.has(header)) {
      throw new Error(`OECD CPI SDMX response omitted required column ${header}`);
    }
  }

  const observations = new Map<string, BlsObservationRow>();
  for (const [rowIndex, columns] of csvRows.slice(1).entries()) {
    if (columns.every((column) => column === '')) {
      continue;
    }
    for (const [dimension, expected] of Object.entries(OECD_REQUIRED_DIMENSIONS)) {
      const actual = columns[headerIndexes.get(dimension)!];
      if (actual !== expected) {
        throw new Error(
          `OECD CPI row ${rowIndex + 2} had ${dimension}=${actual ?? '<missing>'}, expected ${expected}`,
        );
      }
    }
    const period = columns[headerIndexes.get('TIME_PERIOD')!];
    if (!period || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
      throw new Error(`OECD CPI row ${rowIndex + 2} had invalid TIME_PERIOD=${period ?? ''}`);
    }
    if (observations.has(period)) {
      throw new Error(`OECD CPI returned duplicate period ${period}`);
    }
    const sourceValue = Number(columns[headerIndexes.get('OBS_VALUE')!]);
    if (!Number.isFinite(sourceValue) || sourceValue <= 0 || sourceValue >= 1_000) {
      throw new Error(`OECD CPI returned an invalid value for ${period}`);
    }
    const restored = roundToThreeDecimals((sourceValue * BLS_US_CPI_2015_ANNUAL_AVERAGE) / 100);
    observations.set(period, {
      year: period.slice(0, 4),
      period: `M${period.slice(5, 7)}`,
      value: restored.toFixed(3),
    });
  }

  const periods = [...observations.keys()].sort();
  if (periods.length === 0) {
    throw new Error(`OECD CPI SDMX series ${OECD_US_CPI_SERIES_PATH} returned no observations`);
  }
  assertContinuousMonthlyPeriods(periods, 'OECD CPI');
  const latest = periods.at(-1)!;
  if (latest < minimumRecentPeriod) {
    throw new Error(
      `OECD CPI series is stale at ${latest}; expected at least ${minimumRecentPeriod}`,
    );
  }
  return periods.map((period) => observations.get(period)!);
}

/** Parses FRED's exact BLS CPIAUCNS graph export in its native 1982-84=100 scale. */
export function parseFredUsCpiCsv(value: string, minimumRecentPeriod: string): BlsObservationRow[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(minimumRecentPeriod)) {
    throw new Error(`Invalid FRED CPI freshness period ${minimumRecentPeriod}`);
  }
  const csvRows = parseCsvRows(value);
  const headers = csvRows[0];
  if (headers?.[0] !== 'observation_date' || headers[1] !== FRED_US_CPI_SERIES_ID) {
    throw new Error(`FRED graph CSV did not identify the exact series ${FRED_US_CPI_SERIES_ID}`);
  }

  const sourcePeriods = new Set<string>();
  const observations = new Map<string, BlsObservationRow>();
  for (const [rowIndex, columns] of csvRows.slice(1).entries()) {
    if (columns.every((column) => column === '')) {
      continue;
    }
    const date = columns[0];
    if (!date || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(date)) {
      throw new Error(`FRED CPI row ${rowIndex + 2} had invalid observation_date=${date ?? ''}`);
    }
    const period = date.slice(0, 7);
    if (sourcePeriods.has(period)) {
      throw new Error(`FRED CPI returned duplicate period ${period}`);
    }
    sourcePeriods.add(period);

    const rawValue = columns[1];
    if (rawValue === '.' || rawValue === '') {
      if (!BLS_US_CPI_INTENTIONALLY_UNPUBLISHED_PERIODS.has(period)) {
        throw new Error(`FRED CPI returned an unavailable value for ${period}`);
      }
      continue;
    }
    const observation = Number(rawValue);
    if (!Number.isFinite(observation) || observation <= 0 || observation >= 1_000) {
      throw new Error(`FRED CPI returned an invalid value for ${period}`);
    }
    observations.set(period, {
      year: period.slice(0, 4),
      period: `M${period.slice(5, 7)}`,
      value: observation.toFixed(3),
    });
  }

  const sourcePeriodList = [...sourcePeriods].sort();
  if (sourcePeriodList.length === 0 || observations.size === 0) {
    throw new Error(`FRED graph CSV series ${FRED_US_CPI_SERIES_ID} returned no observations`);
  }
  assertContinuousMonthlyPeriods(sourcePeriodList, 'FRED CPI');
  const observationPeriods = [...observations.keys()].sort();
  const latest = observationPeriods.at(-1)!;
  if (latest < minimumRecentPeriod) {
    throw new Error(
      `FRED CPI series is stale at ${latest}; expected at least ${minimumRecentPeriod}`,
    );
  }
  return observationPeriods.map((period) => observations.get(period)!);
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = value.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error('OECD CPI SDMX response contained an unterminated CSV quote');
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function minimumRecentCpiPeriod(now: Date): string {
  const currentMonth = shanghaiDate(now).slice(0, 6);
  const year = Number(currentMonth.slice(0, 4));
  const monthIndex = Number(currentMonth.slice(4, 6)) - 1;
  const minimum = new Date(Date.UTC(year, monthIndex - 2, 1));
  return `${minimum.getUTCFullYear()}-${String(minimum.getUTCMonth() + 1).padStart(2, '0')}`;
}

function assertContinuousMonthlyPeriods(periods: string[], source: string): void {
  for (let index = 1; index < periods.length; index += 1) {
    const previous = periods[index - 1]!;
    let expected = nextDashedMonth(previous);
    while (
      BLS_US_CPI_INTENTIONALLY_UNPUBLISHED_PERIODS.has(expected) &&
      periods[index] !== expected
    ) {
      expected = nextDashedMonth(expected);
    }
    if (periods[index] !== expected) {
      throw new Error(`${source} series has a gap after ${previous}; expected ${expected}`);
    }
  }
}

function nextDashedMonth(period: string): string {
  const next = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function roundToThreeDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function httpBodySuffix(value: string): string {
  const detail = value.replace(/\s+/g, ' ').trim().slice(0, 160);
  return detail === '' ? '' : `: ${detail}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Parses one exact series from BLS's tab-separated CPI All Items bulk file. */
export function parseBlsBulkFile(value: string, seriesId: string): BlsObservationRow[] {
  const rows: BlsObservationRow[] = [];
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (index === 0 || line.trim() === '') {
      continue;
    }
    const columns = line.split('\t');
    if (columns[0]?.trim() !== seriesId) {
      continue;
    }
    const year = columns[1]?.trim();
    const period = columns[2]?.trim();
    const observation = columns[3]?.trim();
    if (!year || !period || !observation) {
      throw new Error(
        `BLS All Items file returned a malformed ${seriesId} row at line ${index + 1}`,
      );
    }
    rows.push({ year, period, value: observation });
  }
  if (rows.length === 0) {
    throw new Error(`BLS All Items file did not contain the requested series ${seriesId}`);
  }
  return rows;
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

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
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
