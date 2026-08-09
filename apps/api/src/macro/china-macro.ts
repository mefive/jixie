import { addDays, daysBetween } from '../lib/date.js';
import { prisma } from '../lib/prisma.js';
import type { TushareRow } from '../tushare/client.js';

export type MacroAvailabilityKind = 'official_schedule' | 'conservative_lag';
export type MacroVintageKind = 'captured_as_available' | 'latest_value_backfill';

export interface ChinaMacroClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface ChinaMacroSeriesDefinition {
  seriesKey: string;
  nameZh: string;
  nameEn: string;
  domain: 'growth' | 'inflation';
  frequency: 'monthly';
  unit: 'index_point' | 'percent';
  source: 'tushare_nbs';
  sourceApi: 'cn_pmi' | 'cn_cpi' | 'cn_ppi';
  sourceField: string;
  defaultTransform: 'level' | 'yoy_level';
  revisionPolicy: 'latest_value_with_captured_vintages';
  fallbackLagDays: 7 | 20;
}

export interface MacroScheduleRow {
  publishDate: string;
  title: string;
  publishMonth: string;
  issuingOrg: string;
  dataApi: string | null;
}

export interface PreparedMacroObservation {
  seriesKey: string;
  period: string;
  value: number;
  releaseDate: string | null;
  availableDate: string;
  availabilityKind: MacroAvailabilityKind;
}

export interface ChinaMacroSyncSummary {
  series: number;
  sourceRows: number;
  scheduleRows: number;
  insertedVintages: number;
  unchangedObservations: number;
  deferredObservations: number;
}

export const CHINA_MACRO_SERIES: readonly ChinaMacroSeriesDefinition[] = [
  {
    seriesKey: 'cn_pmi_manufacturing',
    nameZh: '中国制造业采购经理指数',
    nameEn: 'China Manufacturing PMI',
    domain: 'growth',
    frequency: 'monthly',
    unit: 'index_point',
    source: 'tushare_nbs',
    sourceApi: 'cn_pmi',
    sourceField: 'PMI010000',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 7,
  },
  {
    seriesKey: 'cn_cpi_yoy',
    nameZh: '中国居民消费价格同比',
    nameEn: 'China CPI YoY',
    domain: 'inflation',
    frequency: 'monthly',
    unit: 'percent',
    source: 'tushare_nbs',
    sourceApi: 'cn_cpi',
    sourceField: 'nt_yoy',
    defaultTransform: 'yoy_level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_ppi_yoy',
    nameZh: '中国工业生产者出厂价格同比',
    nameEn: 'China PPI YoY',
    domain: 'inflation',
    frequency: 'monthly',
    unit: 'percent',
    source: 'tushare_nbs',
    sourceApi: 'cn_ppi',
    sourceField: 'ppi_yoy',
    defaultTransform: 'yoy_level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
];

const FIRST_SCHEDULE_MONTH = '202601';
const BACKFILL_THRESHOLD_DAYS = 45;
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Syncs normalized NBS macro series while preserving capture vintages and availability evidence. */
export async function syncChinaMacroData(
  client: ChinaMacroClient,
  startMonth: string,
  endMonth: string,
  onLog: (line: string) => void = console.log,
  retrievedAt = new Date(),
): Promise<ChinaMacroSyncSummary> {
  assertMonthRange(startMonth, endMonth);
  const scheduleMonths =
    endMonth < FIRST_SCHEDULE_MONTH
      ? []
      : monthRange(maximumMonth(startMonth, FIRST_SCHEDULE_MONTH), addMonths(endMonth, 1));
  const [sourceBatches, scheduleBatches] = await Promise.all([
    Promise.all(
      [...new Set(CHINA_MACRO_SERIES.map((definition) => definition.sourceApi))].map(
        async (sourceApi) => ({
          sourceApi,
          rows: await client.call(sourceApi, { start_m: startMonth, end_m: endMonth }),
        }),
      ),
    ),
    Promise.all(
      scheduleMonths.map(async (month) => ({
        month,
        rows: await client.call('cn_schedule', { m: month }),
      })),
    ),
  ]);
  const schedules = parseMacroScheduleRows(scheduleBatches.flatMap((batch) => batch.rows));
  const openDates = await loadOpenDates(startMonth, endMonth);
  const prepared = CHINA_MACRO_SERIES.flatMap((definition) => {
    const rows =
      sourceBatches.find((batch) => batch.sourceApi === definition.sourceApi)?.rows ?? [];
    return prepareMacroObservations(definition, rows, schedules, openDates);
  });
  const vintageDate = chinaDate(retrievedAt);
  const ready = prepared.filter((observation) => observation.availableDate <= vintageDate);

  await prisma.$transaction(
    CHINA_MACRO_SERIES.map((definition) =>
      prisma.macroSeries.upsert({
        where: { seriesKey: definition.seriesKey },
        create: catalogData(definition),
        update: catalogData(definition),
      }),
    ),
  );
  if (schedules.length > 0) {
    await prisma.$transaction(
      schedules.map((schedule) =>
        prisma.macroReleaseSchedule.upsert({
          where: {
            publishDate_title: {
              publishDate: schedule.publishDate,
              title: schedule.title,
            },
          },
          create: { ...schedule, retrievedAt },
          update: { ...schedule, retrievedAt },
        }),
      ),
    );
  }

  const existing = await prisma.macroObservation.findMany({
    where: { seriesKey: { in: CHINA_MACRO_SERIES.map((definition) => definition.seriesKey) } },
    orderBy: [{ seriesKey: 'asc' }, { period: 'asc' }, { vintageDate: 'desc' }],
  });
  const latestByObservation = new Map<string, (typeof existing)[number]>();
  for (const observation of existing) {
    const key = `${observation.seriesKey}|${observation.period}`;
    if (!latestByObservation.has(key)) {
      latestByObservation.set(key, observation);
    }
  }

  const changed = ready.filter((observation) => {
    const current = latestByObservation.get(`${observation.seriesKey}|${observation.period}`);
    return !current || !sameObservation(current, observation);
  });
  if (changed.length > 0) {
    await prisma.$transaction(
      changed.map((observation) =>
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

  const summary = {
    series: CHINA_MACRO_SERIES.length,
    sourceRows: sourceBatches.reduce((sum, batch) => sum + batch.rows.length, 0),
    scheduleRows: schedules.length,
    insertedVintages: changed.length,
    unchangedObservations: ready.length - changed.length,
    deferredObservations: prepared.length - ready.length,
  };
  onLog(
    `China macro ${startMonth}..${endMonth}: ${summary.insertedVintages} vintages inserted, ${summary.unchangedObservations} unchanged, ${summary.deferredObservations} deferred`,
  );
  return summary;
}

export function parseMacroScheduleRows(rows: TushareRow[]): MacroScheduleRow[] {
  const schedules = new Map<string, MacroScheduleRow>();
  for (const row of rows) {
    const publishDate = stringField(row, 'publish_date');
    const title = stringField(row, 'title');
    const publishMonth = stringField(row, 'month');
    const issuingOrg = stringField(row, 'issuing_org');
    const dataApi = nullableStringField(row, 'data_api');
    if (
      !/^\d{8}$/.test(publishDate) ||
      !/^\d{6}$/.test(publishMonth) ||
      publishDate.slice(0, 6) !== publishMonth ||
      !title ||
      !issuingOrg
    ) {
      throw new Error('China macro schedule returned an invalid release row');
    }
    schedules.set(`${publishDate}|${title}`, {
      publishDate,
      title,
      publishMonth,
      issuingOrg,
      dataApi,
    });
  }
  return [...schedules.values()].sort(
    (left, right) =>
      left.publishDate.localeCompare(right.publishDate) || left.title.localeCompare(right.title),
  );
}

export function prepareMacroObservations(
  definition: ChinaMacroSeriesDefinition,
  rows: TushareRow[],
  schedules: MacroScheduleRow[],
  openDates: string[],
): PreparedMacroObservation[] {
  const periods = new Set<string>();
  const observations: PreparedMacroObservation[] = [];
  for (const row of rows) {
    const period = stringField(row, 'month');
    if (!/^\d{6}$/.test(period)) {
      throw new Error(`${definition.sourceApi} returned invalid month ${period}`);
    }
    if (periods.has(period)) {
      throw new Error(`${definition.sourceApi} returned duplicate month ${period}`);
    }
    periods.add(period);
    const value = numericField(row, definition.sourceField);
    if (value == null) {
      continue;
    }
    const releaseDate = officialReleaseDate(definition, period, schedules);
    const availabilityAnchor = releaseDate ?? addDays(monthEnd(period), definition.fallbackLagDays);
    const availableDate = openDates.find((date) => date >= availabilityAnchor);
    if (!availableDate) {
      throw new Error(
        `TradeCal has no SSE open date on or after ${availabilityAnchor} for ${definition.seriesKey} ${period}`,
      );
    }
    observations.push({
      seriesKey: definition.seriesKey,
      period,
      value,
      releaseDate,
      availableDate,
      availabilityKind: releaseDate ? 'official_schedule' : 'conservative_lag',
    });
  }
  return observations.sort((left, right) => left.period.localeCompare(right.period));
}

function officialReleaseDate(
  definition: ChinaMacroSeriesDefinition,
  period: string,
  schedules: MacroScheduleRow[],
): string | null {
  const candidates = schedules.filter((schedule) => schedule.dataApi === definition.sourceApi);
  if (definition.sourceApi === 'cn_pmi') {
    const start = `${period}25`;
    const end = `${addMonths(period, 1)}07`;
    return (
      candidates.find((schedule) => schedule.publishDate >= start && schedule.publishDate <= end)
        ?.publishDate ?? null
    );
  }
  const releaseMonth = addMonths(period, 1);
  return (
    candidates.find(
      (schedule) =>
        schedule.publishDate >= `${releaseMonth}01` && schedule.publishDate <= `${releaseMonth}20`,
    )?.publishDate ?? null
  );
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

function catalogData(definition: ChinaMacroSeriesDefinition) {
  return {
    seriesKey: definition.seriesKey,
    nameZh: definition.nameZh,
    nameEn: definition.nameEn,
    domain: definition.domain,
    frequency: definition.frequency,
    unit: definition.unit,
    source: definition.source,
    sourceApi: definition.sourceApi,
    sourceField: definition.sourceField,
    defaultTransform: definition.defaultTransform,
    revisionPolicy: definition.revisionPolicy,
  };
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

export function macroVintageKind(availableDate: string, vintageDate: string): MacroVintageKind {
  return daysBetween(availableDate, vintageDate) > BACKFILL_THRESHOLD_DAYS
    ? 'latest_value_backfill'
    : 'captured_as_available';
}

function stringField(row: TushareRow, field: string): string {
  const value = fieldValue(row, field);
  return value == null ? '' : String(value).trim();
}

function nullableStringField(row: TushareRow, field: string): string | null {
  const value = stringField(row, field);
  return value || null;
}

function numericField(row: TushareRow, field: string): number | null {
  const value = fieldValue(row, field);
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`China macro source returned non-numeric ${field}`);
  }
  return numeric;
}

function fieldValue(row: TushareRow, field: string) {
  const matchingKey = Object.keys(row).find((key) => key.toLowerCase() === field.toLowerCase());
  return matchingKey ? row[matchingKey] : null;
}

function chinaDate(value: Date): string {
  const parts = Object.fromEntries(
    CHINA_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

function monthEnd(month: string): string {
  const value = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)), 0));
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

function addMonths(month: string, count: number): string {
  const value = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1 + count, 1),
  );
  return value.toISOString().slice(0, 7).replace('-', '');
}

function monthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  for (let month = startMonth; month <= endMonth; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

function maximumMonth(left: string, right: string): string {
  return left >= right ? left : right;
}

function assertMonthRange(startMonth: string, endMonth: string): void {
  if (!/^\d{6}$/.test(startMonth) || !/^\d{6}$/.test(endMonth) || startMonth > endMonth) {
    throw new Error('start/end must be YYYYMM and start must not exceed end');
  }
  if (Number(startMonth.slice(4, 6)) < 1 || Number(startMonth.slice(4, 6)) > 12) {
    throw new Error('start month is invalid');
  }
  if (Number(endMonth.slice(4, 6)) < 1 || Number(endMonth.slice(4, 6)) > 12) {
    throw new Error('end month is invalid');
  }
}
