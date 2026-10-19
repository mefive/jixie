import { addDays, daysBetween } from '#date';
import { prisma } from '#infra/database/prisma.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';

export type MacroAvailabilityKind = 'official_schedule' | 'published_intraday' | 'conservative_lag';
export type MacroVintageKind = 'captured_as_available' | 'latest_value_backfill';

export type ChinaMacroSourceApi = 'cn_pmi' | 'cn_cpi' | 'cn_ppi' | 'cn_m' | 'sf_month' | 'shibor';

/**
 * 隔离中国宏观来源与日程获取能力。
 *
 * Abstract China macro source and release-schedule fetching.
 */
export interface ChinaMacroClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

/**
 * 定义宏观序列身份、单位与来源映射，供规范化同步。
 *
 * Define macro identity, units and source mapping for normalized synchronization.
 */
export interface ChinaMacroSeriesDefinition {
  seriesKey: string;
  nameZh: string;
  nameEn: string;
  domain: 'growth' | 'inflation' | 'liquidity' | 'credit';
  frequency: 'daily' | 'monthly';
  unit: 'index_point' | 'percent' | '100m_cny' | 'trillion_cny';
  source: 'tushare_nbs' | 'tushare_pboc' | 'tushare_chinamoney';
  sourceApi: ChinaMacroSourceApi;
  sourceField: string;
  defaultTransform: 'level' | 'yoy_level';
  revisionPolicy: 'latest_value_with_captured_vintages';
  fallbackLagDays: 0 | 7 | 20;
}

/**
 * 限定宏观来源 API 及有界参数，防止截断。
 *
 * Describe a bounded macro source request to prevent truncation.
 */
export interface ChinaMacroSourceRequest {
  sourceApi: ChinaMacroSourceApi;
  params: Record<string, unknown>;
  fields?: string;
}

/**
 * 携带宏观发布日程证据，供可得日映射。
 *
 * Supply macro release-schedule evidence for availability mapping.
 */
export interface MacroScheduleRow {
  publishDate: string;
  title: string;
  publishMonth: string;
  issuingOrg: string;
  dataApi: string | null;
}

/**
 * 组合标准化宏观值、可得日与抓取版本，供追加保存。
 *
 * Collect normalized macro values, availability and capture vintage for persistence.
 */
export interface PreparedMacroObservation {
  seriesKey: string;
  period: string;
  value: number;
  releaseDate: string | null;
  availableDate: string;
  availabilityKind: MacroAvailabilityKind;
}

/**
 * 汇总宏观来源请求与版本写入结果。
 *
 * Summarize macro fetching and vintage persistence.
 */
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
  {
    seriesKey: 'cn_m1_balance',
    nameZh: '中国狭义货币 M1 余额',
    nameEn: 'China M1 Balance',
    domain: 'liquidity',
    frequency: 'monthly',
    unit: '100m_cny',
    source: 'tushare_pboc',
    sourceApi: 'cn_m',
    sourceField: 'm1',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_m1_yoy',
    nameZh: '中国狭义货币 M1 同比',
    nameEn: 'China M1 YoY',
    domain: 'liquidity',
    frequency: 'monthly',
    unit: 'percent',
    source: 'tushare_pboc',
    sourceApi: 'cn_m',
    sourceField: 'm1_yoy',
    defaultTransform: 'yoy_level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_m2_balance',
    nameZh: '中国广义货币 M2 余额',
    nameEn: 'China M2 Balance',
    domain: 'liquidity',
    frequency: 'monthly',
    unit: '100m_cny',
    source: 'tushare_pboc',
    sourceApi: 'cn_m',
    sourceField: 'm2',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_m2_yoy',
    nameZh: '中国广义货币 M2 同比',
    nameEn: 'China M2 YoY',
    domain: 'liquidity',
    frequency: 'monthly',
    unit: 'percent',
    source: 'tushare_pboc',
    sourceApi: 'cn_m',
    sourceField: 'm2_yoy',
    defaultTransform: 'yoy_level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_social_financing_increment',
    nameZh: '中国社会融资规模当月增量',
    nameEn: 'China Aggregate Financing Monthly Increment',
    domain: 'credit',
    frequency: 'monthly',
    unit: '100m_cny',
    source: 'tushare_pboc',
    sourceApi: 'sf_month',
    sourceField: 'inc_month',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_social_financing_stock',
    nameZh: '中国社会融资规模存量',
    nameEn: 'China Aggregate Financing Outstanding',
    domain: 'credit',
    frequency: 'monthly',
    unit: 'trillion_cny',
    source: 'tushare_pboc',
    sourceApi: 'sf_month',
    sourceField: 'stk_endval',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 20,
  },
  {
    seriesKey: 'cn_shibor_overnight',
    nameZh: 'Shibor 隔夜',
    nameEn: 'Shibor Overnight',
    domain: 'liquidity',
    frequency: 'daily',
    unit: 'percent',
    source: 'tushare_chinamoney',
    sourceApi: 'shibor',
    sourceField: 'on',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 0,
  },
  {
    seriesKey: 'cn_shibor_1w',
    nameZh: 'Shibor 1 周',
    nameEn: 'Shibor 1 Week',
    domain: 'liquidity',
    frequency: 'daily',
    unit: 'percent',
    source: 'tushare_chinamoney',
    sourceApi: 'shibor',
    sourceField: '1w',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 0,
  },
  {
    seriesKey: 'cn_shibor_1m',
    nameZh: 'Shibor 1 个月',
    nameEn: 'Shibor 1 Month',
    domain: 'liquidity',
    frequency: 'daily',
    unit: 'percent',
    source: 'tushare_chinamoney',
    sourceApi: 'shibor',
    sourceField: '1m',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 0,
  },
  {
    seriesKey: 'cn_shibor_3m',
    nameZh: 'Shibor 3 个月',
    nameEn: 'Shibor 3 Month',
    domain: 'liquidity',
    frequency: 'daily',
    unit: 'percent',
    source: 'tushare_chinamoney',
    sourceApi: 'shibor',
    sourceField: '3m',
    defaultTransform: 'level',
    revisionPolicy: 'latest_value_with_captured_vintages',
    fallbackLagDays: 0,
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

/**
 * 同步标准化中国宏观序列，保留抓取版本及可得日期证据。
 *
 * Syncs normalized Chinese macro series while preserving capture vintages and availability evidence.
 */
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
  const [sourceRequestBatches, scheduleBatches] = await Promise.all([
    Promise.all(
      chinaMacroSourceRequests(startMonth, endMonth).map(async (request) => {
        const rows = await client.call(request.sourceApi, request.params, request.fields);

        if (request.sourceApi === 'cn_pmi') {
          validateManufacturingPmiRows(rows, startMonth, endMonth);
        }

        return { sourceApi: request.sourceApi, rows };
      }),
    ),
    Promise.all(
      scheduleMonths.map(async (month) => ({
        month,
        rows: await client.call('cn_schedule', { m: month }),
      })),
    ),
  ]);
  const sourceBatches = mergeSourceRequestBatches(sourceRequestBatches);
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

/**
 * 解析宏观发布日程行，供观测值的披露可得日期匹配。
 *
 * Parse macro release schedule rows for observation availability matching.
 */
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

/**
 * 规范化宏观数值与披露证据，形成可追加的版本化观测。
 *
 * Normalize macro values and release evidence into versioned observations.
 */
export function prepareMacroObservations(
  definition: ChinaMacroSeriesDefinition,
  rows: TushareRow[],
  schedules: MacroScheduleRow[],
  openDates: string[],
): PreparedMacroObservation[] {
  const periods = new Set<string>();
  const observations: PreparedMacroObservation[] = [];
  for (const row of rows) {
    const periodField = definition.frequency === 'daily' ? 'date' : 'month';
    const period = stringField(row, periodField);
    const periodPattern = definition.frequency === 'daily' ? /^\d{8}$/ : /^\d{6}$/;
    if (!periodPattern.test(period)) {
      throw new Error(`${definition.sourceApi} returned invalid ${periodField} ${period}`);
    }
    if (periods.has(period)) {
      throw new Error(`${definition.sourceApi} returned duplicate ${periodField} ${period}`);
    }
    periods.add(period);
    const value = numericField(row, definition.sourceField);
    if (value == null) {
      continue;
    }
    const releaseDate =
      definition.frequency === 'daily'
        ? period
        : officialReleaseDate(definition, period, schedules);
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
      availabilityKind:
        definition.frequency === 'daily'
          ? 'published_intraday'
          : releaseDate
            ? 'official_schedule'
            : 'conservative_lag',
    });
  }
  return observations.sort((left, right) => left.period.localeCompare(right.period));
}

/**
 * 为 Shibor 等来源生成有界请求，避免静默超过 2,000 行截断。
 *
 * Builds bounded requests so Shibor never silently truncates at its 2,000-row API limit.
 */
export function chinaMacroSourceRequests(
  startMonth: string,
  endMonth: string,
): ChinaMacroSourceRequest[] {
  assertMonthRange(startMonth, endMonth);
  const monthlyApis = [
    ...new Set(
      CHINA_MACRO_SERIES.filter((definition) => definition.frequency === 'monthly').map(
        (definition) => definition.sourceApi,
      ),
    ),
  ];
  const requests: ChinaMacroSourceRequest[] = monthlyApis.map((sourceApi) => ({
    sourceApi,
    params: { start_m: startMonth, end_m: endMonth },
    ...(sourceApi === 'cn_pmi' ? { fields: 'month,pmi010000' } : {}),
  }));
  const startDate = `${startMonth}01`;
  const endDate = monthEnd(endMonth);
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    requests.push({
      sourceApi: 'shibor',
      params: {
        start_date: maximumDate(startDate, `${year}0101`),
        end_date: minimumDate(endDate, `${year}1231`),
      },
    });
  }
  return requests;
}

/**
 * 在写库前拒绝 PMI 缺列、重复月份和非法值，避免供应商静默忽略字段。
 *
 * Reject missing PMI columns, duplicate months and invalid values before any database writes.
 */
function validateManufacturingPmiRows(
  rows: TushareRow[],
  startMonth: string,
  endMonth: string,
): void {
  if (rows.length === 0) {
    throw new Error('cn_pmi returned no manufacturing PMI observations');
  }

  const months = new Set<string>();

  for (const row of rows) {
    const month = fieldValue(row, 'month');

    if (typeof month !== 'string' || !/^\d{4}(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error(`cn_pmi returned invalid month ${String(month)}`);
    }
    if (month < startMonth || month > endMonth) {
      throw new Error(`cn_pmi returned month ${month} outside ${startMonth}..${endMonth}`);
    }
    if (months.has(month)) {
      throw new Error(`cn_pmi returned duplicate month ${month}`);
    }

    months.add(month);

    const sourceValue = fieldValue(row, 'pmi010000');

    if (
      (typeof sourceValue !== 'number' && typeof sourceValue !== 'string') ||
      (typeof sourceValue === 'string' && sourceValue.trim() === '')
    ) {
      throw new Error(`cn_pmi returned missing or invalid pmi010000 for ${month}`);
    }

    const value = Number(sourceValue);

    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`cn_pmi returned invalid pmi010000 for ${month}: ${String(sourceValue)}`);
    }
  }
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

function mergeSourceRequestBatches(
  batches: Array<{ sourceApi: ChinaMacroSourceApi; rows: TushareRow[] }>,
): Array<{ sourceApi: ChinaMacroSourceApi; rows: TushareRow[] }> {
  const rowsByApi = new Map<ChinaMacroSourceApi, TushareRow[]>();
  for (const batch of batches) {
    rowsByApi.set(batch.sourceApi, [...(rowsByApi.get(batch.sourceApi) ?? []), ...batch.rows]);
  }
  return [...rowsByApi].map(([sourceApi, rows]) => ({ sourceApi, rows }));
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

function maximumDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minimumDate(left: string, right: string): string {
  return left <= right ? left : right;
}

/**
 * 校验宏观同步月份范围，防止非法或倒序请求。
 *
 * Validate the requested macro month range before source fetching.
 */
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
