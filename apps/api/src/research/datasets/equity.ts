import type { PrismaClient } from '@prisma/client';
import type {
  ResearchDiagnosticV1,
  ResearchEntitySetSourceV1,
  ResearchUniverseRunResultV1,
  UniverseSpecV1,
} from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { researchUniverseMeasures } from '../catalog/capabilities.js';
import { executeUniverseSpec } from './universe.js';
import { universeSpecV1Schema } from '@jixie/shared/api/research';

const MAX_CROSS_SECTION_ROWS = 6_000;
const MAX_PANEL_PERIODS = 120;
const MAX_PANEL_ROWS = 100_000;

/**
 * 约束股票研究的证券、期间与返回行数，防止无界读取。
 * Bound research instruments, periods and rows to prevent unbounded equity queries.
 */
interface ResearchEquityDatasetLimits {
  maxCrossSectionRows?: number;
  maxPanelRows?: number;
}

/**
 * 共享股票数据集日期、字段和证券池请求。
 * Describe shared equity dataset dates, fields and universe input.
 */
export interface ResearchEquityDatasetRequestBaseV1 {
  universe: string;
  minimum_listed_days: number;
  risk_warning: 'exclude' | 'include';
}

/**
 * 指定单个历史日期的股票截面请求。
 * Request one historical equity cross-section.
 */
export interface ResearchCrossSectionRequestV1 extends ResearchEquityDatasetRequestBaseV1 {
  date: string;
}

/**
 * 指定完成月末采样的股票 Panel 请求。
 * Request an equity panel sampled at completed month ends.
 */
export interface ResearchPanelRequestV1 extends ResearchEquityDatasetRequestBaseV1 {
  start: string;
  end: string;
  frequency: 'month_end';
}

/**
 * 定义公开股票研究行，隔离内部存储字段。
 * Define public equity research rows independently of storage fields.
 */
export interface ResearchEquityDatasetRowV1 {
  date: string;
  code: string;
  name: string;
  industry: string | null;
  close: number | null;
  adjusted_close: number | null;
  daily_return_pct: number | null;
  volume_lot: number | null;
  amount_cny_1k: number | null;
  pe: number | null;
  pe_ttm: number | null;
  pb: number | null;
  ps: number | null;
  dividend_yield_pct: number | null;
  total_market_cap_cny_10k: number | null;
  float_market_cap_cny_10k: number | null;
  turnover_rate_pct: number | null;
}

/**
 * 记录股票采样日期与样本覆盖，供结果解释。
 * Retain equity sampling dates and coverage for interpretation.
 */
export interface ResearchEquityDatasetPeriodV1 {
  requestedDate: string;
  dataDate: string;
  membershipAsOfDate: string | null;
  rows: number;
}

/**
 * 描述股票数据集的口径、来源与缺失限制。
 * Describe equity dataset conventions, provenance and missing-data limits.
 */
export interface ResearchEquityDatasetMetadataV1 {
  version: 1;
  kind: 'cross_section' | 'panel';
  universe: string;
  minimumListedDays: number;
  riskWarning: 'exclude' | 'include';
  dataRevision: number;
  rowCount: number;
  periods: ResearchEquityDatasetPeriodV1[];
  diagnostics: ResearchDiagnosticV1[];
}

/**
 * 组合股票公开数据、采样期间和可复现元数据。
 * Return public equity rows, sampled periods and reproducibility metadata.
 */
export interface ResearchEquityDatasetResultV1 {
  rows: ResearchEquityDatasetRowV1[];
  metadata: ResearchEquityDatasetMetadataV1;
}

/**
 * 通过与 UniverseSpec 相同的规则读取有界时点股票截面。
 * Load one bounded point-in-time equity cross-section through the same rules as UniverseSpec.
 */
export async function loadResearchCrossSection(
  request: ResearchCrossSectionRequestV1,
  database: PrismaClient = prisma,
  limits: ResearchEquityDatasetLimits = {},
): Promise<ResearchEquityDatasetResultV1> {
  validateDatasetRequest(request);
  const result = await executeDatasetPeriod(request, request.date, database);
  const maxRows = limits.maxCrossSectionRows ?? MAX_CROSS_SECTION_ROWS;
  if (result.rows.length > maxRows) {
    throw new Error(
      `Research cross-section contains ${result.rows.length} rows; the limit is ${maxRows}. Use a narrower index universe.`,
    );
  }

  return datasetResult('cross_section', request, [result]);
}

/**
 * 读取已完成月末截面，缺失月份不沿用上月值。
 * Load completed month-end cross-sections without carrying a missing month's values forward.
 */
export async function loadResearchPanel(
  request: ResearchPanelRequestV1,
  database: PrismaClient = prisma,
  limits: ResearchEquityDatasetLimits = {},
): Promise<ResearchEquityDatasetResultV1> {
  validateDatasetRequest(request);
  if (request.frequency !== 'month_end') {
    throw new Error(`Unsupported Research panel frequency: ${request.frequency}`);
  }
  if (request.start > request.end) {
    throw new Error('Research panel start must not be after end');
  }

  const dates = await completedMonthEndDates(request.start, request.end, database);
  if (dates.length === 0) {
    throw new Error('Research panel has no completed SSE month end in the requested range');
  }
  if (dates.length > MAX_PANEL_PERIODS) {
    throw new Error(
      `Research panel requests ${dates.length} periods; the limit is ${MAX_PANEL_PERIODS}. Use a shorter date range.`,
    );
  }

  const periods: DatasetPeriod[] = [];
  let rowCount = 0;
  const maxRows = limits.maxPanelRows ?? MAX_PANEL_ROWS;
  for (const date of dates) {
    const period = await executeDatasetPeriod(request, date, database);
    if (period.result.asOfDate !== date) {
      throw new Error(`Research panel has no market-data snapshot on month end ${date}`);
    }
    rowCount += period.rows.length;
    if (rowCount > maxRows) {
      throw new Error(
        `Research panel exceeds the ${maxRows}-row limit at ${date}. Use a narrower universe or shorter date range.`,
      );
    }
    periods.push(period);
  }

  return datasetResult('panel', request, periods);
}

/**
 * 承载内部采样日期和有效证券集，供逐期加载。
 * Describe an internal sampling date and eligible instrument set.
 */
interface DatasetPeriod {
  requestedDate: string;
  result: ResearchUniverseRunResultV1;
  rows: ResearchEquityDatasetRowV1[];
}

/**
 * 执行一个数据集采样日的时点证券池与字段读取。
 * Execute point-in-time universe and field reads for one dataset period.
 */
async function executeDatasetPeriod(
  request: ResearchEquityDatasetRequestBaseV1,
  date: string,
  database: PrismaClient,
): Promise<DatasetPeriod> {
  const spec: UniverseSpecV1 = {
    version: 1,
    source: equityUniverseSource(request.universe),
    asOf: { kind: 'fixed', date },
    eligibility: {
      minimumListedDays: request.minimum_listed_days,
      suspension: 'exclude',
      riskWarning: request.risk_warning,
    },
    predicates: [],
    missing: 'exclude',
    select: researchUniverseMeasures.map((measure) => ({
      measure: measure.id,
      measureVersion: 1 as const,
    })),
  };
  const result = await executeUniverseSpec(universeSpecV1Schema.parse(spec), database, {
    defaultLimit: null,
  });
  return {
    requestedDate: date,
    result,
    rows: result.rows.map((row) => equityDatasetRow(result.asOfDate, row)),
  };
}

/**
 * 组合数据行、期间和覆盖元数据，形成统一股票研究响应。
 * Assemble rows, periods and coverage metadata into the equity research response.
 */
function datasetResult(
  kind: ResearchEquityDatasetMetadataV1['kind'],
  request: ResearchEquityDatasetRequestBaseV1,
  periods: DatasetPeriod[],
): ResearchEquityDatasetResultV1 {
  const revisions = new Set(periods.map((period) => period.result.dataRevision));
  if (revisions.size !== 1) {
    throw new Error('Research market data changed while the panel was loading; rerun the Cell');
  }
  const rows = periods.flatMap((period) => period.rows);
  return {
    rows,
    metadata: {
      version: 1,
      kind,
      universe: request.universe,
      minimumListedDays: request.minimum_listed_days,
      riskWarning: request.risk_warning,
      dataRevision: periods[0]!.result.dataRevision,
      rowCount: rows.length,
      periods: periods.map((period) => ({
        requestedDate: period.requestedDate,
        dataDate: period.result.asOfDate,
        membershipAsOfDate: period.result.membershipAsOfDate,
        rows: period.rows.length,
      })),
      diagnostics: periods.flatMap((period) =>
        period.result.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          messageZh: `[${period.requestedDate}] ${diagnostic.messageZh}`,
          messageEn: `[${period.requestedDate}] ${diagnostic.messageEn}`,
        })),
      ),
    },
  };
}

/**
 * 将已选证券行映射为研究公开字段，保持缺失与单位口径。
 * Map selected instrument rows to public research fields with explicit missing values and units.
 */
function equityDatasetRow(
  date: string,
  row: ResearchUniverseRunResultV1['rows'][number],
): ResearchEquityDatasetRowV1 {
  const value = (measure: string) => row.values[measure] ?? null;
  return {
    date,
    code: row.entity.id,
    name: row.name,
    industry: row.industry,
    close: value('equity.close'),
    adjusted_close: value('equity.adjusted_close'),
    daily_return_pct: value('equity.daily_return_pct'),
    volume_lot: value('equity.volume_lot'),
    amount_cny_1k: value('equity.amount_cny_1k'),
    pe: value('equity.pe'),
    pe_ttm: value('equity.pe_ttm'),
    pb: value('equity.pb'),
    ps: value('equity.ps'),
    dividend_yield_pct: value('equity.dividend_yield_pct'),
    total_market_cap_cny_10k: value('equity.total_market_cap_cny_10k'),
    float_market_cap_cny_10k: value('equity.float_market_cap_cny_10k'),
    turnover_rate_pct: value('equity.turnover_rate_pct'),
  };
}

function equityUniverseSource(universe: string): ResearchEntitySetSourceV1 {
  if (universe === 'cn_a') {
    return { kind: 'equity_market', market: 'CN' };
  }
  const match = universe.match(/^index:([A-Za-z0-9._-]{1,80})$/);
  if (match) {
    return { kind: 'index_members', indexCode: match[1]! };
  }
  throw new Error('Research equity universe must be cn_a or index:<index code>');
}

/**
 * 校验股票数据集日期、证券池和行数上限。
 * Validate equity dataset dates, universe and row limits.
 */
function validateDatasetRequest(request: ResearchEquityDatasetRequestBaseV1): void {
  equityUniverseSource(request.universe);
  if (
    !Number.isInteger(request.minimum_listed_days) ||
    request.minimum_listed_days < 0 ||
    request.minimum_listed_days > 36_500
  ) {
    throw new Error('minimum_listed_days must be an integer from 0 through 36500');
  }
  if (request.risk_warning !== 'exclude' && request.risk_warning !== 'include') {
    throw new Error('risk_warning must be exclude or include');
  }
}

/**
 * 枚举区间内已完成月末的最后交易日，供 Panel 采样。
 * Enumerate completed month-end trading dates for panel sampling.
 */
async function completedMonthEndDates(
  start: string,
  end: string,
  database: PrismaClient,
): Promise<string[]> {
  const latestSnapshot = await database.dailyBasic.findFirst({
    where: { tradeDate: { lte: end } },
    select: { tradeDate: true },
    orderBy: { tradeDate: 'desc' },
  });
  if (!latestSnapshot || latestSnapshot.tradeDate < start) {
    return [];
  }
  const availableEnd = latestSnapshot.tradeDate;
  const openDates = await database.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: availableEnd } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const nextOpen = await database.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: availableEnd } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const dates: string[] = [];
  for (let index = 0; index < openDates.length; index++) {
    const date = openDates[index]!.calDate;
    const nextDate = openDates[index + 1]?.calDate ?? nextOpen?.calDate;
    const month = date.slice(0, 6);
    if (
      (nextDate && nextDate.slice(0, 6) !== month) ||
      (!nextDate && calendarMonthEnd(month) <= availableEnd)
    ) {
      dates.push(date);
    }
  }
  return dates;
}

function calendarMonthEnd(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(4, 6));
  const date = new Date(Date.UTC(year, monthIndex, 0));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}
