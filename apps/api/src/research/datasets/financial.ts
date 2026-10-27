import {
  RESEARCH_FINANCIAL_FIELDS_V1,
  RESEARCH_FINANCIAL_METRICS_V1,
  type ResearchFinancialMetricV1,
} from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';

import {
  FINANCIAL_FORMULA_VERSION,
  FINANCIAL_METRIC_DEFINITIONS,
  calculateFinancialMetrics,
  type FinancialMetricResult,
} from '#market/fundamentals/metrics.js';
import {
  resolveFinancialState,
  resolveFinancialStates,
  type ResolvedFinancialState,
  type ResolvedFinancialStatement,
} from '#market/fundamentals/resolver.js';
import { getDatabase } from '#infra/database/prisma.js';
import {
  loadResearchCrossSection,
  loadResearchPanel,
  type ResearchCrossSectionRequestV1,
  type ResearchEquityDatasetRowV1,
  type ResearchPanelRequestV1,
} from './equity.js';

const MAX_SELECTED_FINANCIAL_METRICS = 8;
const MAX_FINANCIAL_STATEMENT_ROWS = 10_000;
const MAX_FINANCIAL_METRIC_ROWS = 10_000;
const MAX_FINANCIAL_CROSS_SECTION_ROWS = 50_000;
const MAX_FINANCIAL_PANEL_ROWS = 100_000;
const FINANCIAL_METRIC_SET = new Set<string>(RESEARCH_FINANCIAL_METRICS_V1);

/**
 * 指定单证券财务查询的历史日期与范围。
 *
 * Configure an instrument's historical financial query.
 */
export interface ResearchSingleFinancialRequestV1 {
  identifier: string;
  as_of: string;
}

/**
 * 限定原始财报读取的字段、报表类型与报告期。
 *
 * Configure statement fields, types and reporting periods.
 */
export interface ResearchFinancialStatementRequestV1 extends ResearchSingleFinancialRequestV1 {
  fields?: string | string[];
  report_start?: string;
  report_end?: string;
}

/**
 * 指定有界证券池的时点财务指标截面。
 *
 * Request bounded point-in-time financial metrics for a universe.
 */
export interface ResearchFinancialCrossSectionRequestV1 extends ResearchCrossSectionRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

/**
 * 指定历史月末财务指标 Panel，不使用当前值回填。
 *
 * Request historical month-end financial panels without current-value backfill.
 */
export interface ResearchFinancialPanelRequestV1 extends ResearchPanelRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

/**
 * 定义三张表公开长表的字段、数值和版本身份。
 *
 * Describe public statement long-table values and version identity.
 */
export interface ResearchFinancialStatementRowV1 {
  as_of_date: string;
  code: string;
  applicability: ResolvedFinancialState['applicability'];
  report_period: string;
  statement_kind: ResolvedFinancialStatement['statementKind'];
  field: string;
  value: number | null;
  unit: 'CNY' | 'shares';
  announcement_date: string;
  available_date: string;
  availability_quality: string;
  report_type: string;
  source_row_fingerprint: string;
}

/**
 * 定义指标长表的值、单位与缺失诊断。
 *
 * Describe metric long-table values, units and missing-data diagnostics.
 */
export interface ResearchFinancialMetricRowV1 {
  date: string;
  code: string;
  name: string;
  applicability: ResolvedFinancialState['applicability'];
  report_period: string | null;
  metric: ResearchFinancialMetricV1;
  value: number | null;
  unit: 'CNY' | 'shares' | 'ratio';
  status: 'ok' | 'missing' | 'invalid' | 'not_applicable';
  missing_reason: string | null;
  formula: string;
  formula_version: typeof FINANCIAL_FORMULA_VERSION;
  input_versions_json: string;
}

/**
 * 将严格 PIT 的报表状态转换为稳定的有类型长表。
 *
 * Return the strict-PIT statement state as one stable, typed long table.
 */
export async function loadResearchFinancialStatements(
  request: ResearchFinancialStatementRequestV1,
  database: PrismaClient = getDatabase(),
): Promise<ResearchFinancialStatementRowV1[]> {
  const selectedFields = normalizeFinancialFields(request.fields);
  validateFinancialReportRange(request.as_of);
  validateFinancialReportRange(request.report_start, request.report_end);
  const state = await resolveFinancialState(
    { tsCode: request.identifier, asOfDate: request.as_of },
    database,
  );
  const rows = state.periods
    .filter(
      (period) =>
        (!request.report_start || period.endDate >= request.report_start) &&
        (!request.report_end || period.endDate <= request.report_end),
    )
    .flatMap((period) =>
      [period.income, period.balanceSheet, period.cashFlow].flatMap((statement) =>
        statement
          ? statementRows(state, statement).filter(
              (row) => !selectedFields || selectedFields.has(`${row.statement_kind}.${row.field}`),
            )
          : [],
      ),
    );
  assertRowLimit(rows.length, MAX_FINANCIAL_STATEMENT_ROWS, 'financial statement');
  return rows;
}

/**
 * 返回某证券在历史日期已知的全部标准化财务指标。
 *
 * Return all M2 metrics known for one stock on a historical date.
 */
export async function loadResearchFinancialMetrics(
  request: ResearchSingleFinancialRequestV1,
  database: PrismaClient = getDatabase(),
): Promise<ResearchFinancialMetricRowV1[]> {
  const [state, historicalName] = await Promise.all([
    resolveFinancialState({ tsCode: request.identifier, asOfDate: request.as_of }, database),
    database.stockNameHistory.findFirst({
      where: {
        tsCode: request.identifier,
        startDate: { lte: request.as_of },
        OR: [{ endDate: null }, { endDate: { gte: request.as_of } }],
      },
      orderBy: { startDate: 'desc' },
      select: { name: true },
    }),
  ]);
  const rows = metricRowsForState(
    state,
    historicalName?.name ?? state.tsCode,
    [...RESEARCH_FINANCIAL_METRICS_V1],
    'all_periods',
  );
  assertRowLimit(rows.length, MAX_FINANCIAL_METRIC_ROWS, 'single-stock financial metric');
  return rows;
}

/**
 * 以固定次数批量查询返回有界 PIT 财务截面。
 *
 * Return one bounded PIT universe with a constant number of financial database queries.
 */
export async function loadResearchFinancialCrossSection(
  request: ResearchFinancialCrossSectionRequestV1,
  database: PrismaClient = getDatabase(),
): Promise<ResearchFinancialMetricRowV1[]> {
  const metrics = normalizeSelectedMetrics(request.metrics);
  const dataset = await loadResearchCrossSection(request, database);
  assertRowLimit(
    dataset.rows.length * metrics.length,
    MAX_FINANCIAL_CROSS_SECTION_ROWS,
    'financial cross-section',
  );
  const dataDate = dataset.metadata.periods[0]!.dataDate;
  return loadFinancialMetricPeriod(dataset.rows, dataDate, metrics, database);
}

/**
 * 返回历史月末财务快照，不用当前数据回填过去。
 *
 * Return bounded historical month-end financial snapshots without current-data backfill.
 */
export async function loadResearchFinancialPanel(
  request: ResearchFinancialPanelRequestV1,
  database: PrismaClient = getDatabase(),
): Promise<ResearchFinancialMetricRowV1[]> {
  const metrics = normalizeSelectedMetrics(request.metrics);
  const dataset = await loadResearchPanel(request, database, {
    maxPanelRows: Math.floor(MAX_FINANCIAL_PANEL_ROWS / metrics.length),
  });
  assertRowLimit(dataset.rows.length * metrics.length, MAX_FINANCIAL_PANEL_ROWS, 'financial panel');
  const rowsByDate = new Map<string, ResearchEquityDatasetRowV1[]>();
  for (const row of dataset.rows) {
    const rows = rowsByDate.get(row.date) ?? [];
    rows.push(row);
    rowsByDate.set(row.date, rows);
  }

  const output: ResearchFinancialMetricRowV1[] = [];
  for (const [date, rows] of [...rowsByDate].sort(([left], [right]) => left.localeCompare(right))) {
    output.push(...(await loadFinancialMetricPeriod(rows, date, metrics, database)));
  }
  return output;
}

/**
 * 为一个采样日期解析有界证券池并计算所选财务指标。
 *
 * Resolve a bounded universe and selected financial metrics for one sampling date.
 */
async function loadFinancialMetricPeriod(
  rows: ResearchEquityDatasetRowV1[],
  date: string,
  metrics: ResearchFinancialMetricV1[],
  database: PrismaClient,
): Promise<ResearchFinancialMetricRowV1[]> {
  const states = await resolveFinancialStates(
    {
      tsCodes: rows.map((row) => row.code),
      asOfDate: date,
      markets: rows.map((row) => ({
        tsCode: row.code,
        tradeDate: row.date,
        marketCapitalization:
          row.total_market_cap_cny_10k == null ? null : row.total_market_cap_cny_10k * 10_000,
        sourceIdentity: `daily_basic:${row.code}:${row.date}`,
      })),
    },
    database,
  );
  const rowByCode = new Map(rows.map((row) => [row.code, row]));
  return states.flatMap((state) => {
    const row = rowByCode.get(state.tsCode)!;
    return metricRowsForState(state, row.name, metrics, 'latest_period');
  });
}

function statementRows(
  state: ResolvedFinancialState,
  statement: ResolvedFinancialStatement,
): ResearchFinancialStatementRowV1[] {
  return Object.entries(statement.values).map(([field, value]) => ({
    as_of_date: state.asOfDate,
    code: state.tsCode,
    applicability: state.applicability,
    report_period: statement.endDate,
    statement_kind: statement.statementKind,
    field,
    value,
    unit: field === 'totalShare' ? 'shares' : 'CNY',
    announcement_date: statement.announcementDate,
    available_date: statement.availableDate,
    availability_quality: statement.availabilityQuality,
    report_type: statement.reportType,
    source_row_fingerprint: statement.sourceRowFingerprint,
  }));
}

/**
 * 从已解析财务状态生成指标长表行与诊断。
 *
 * Render metric long-table rows and diagnostics from resolved financial state.
 */
function metricRowsForState(
  state: ResolvedFinancialState,
  name: string,
  metrics: ResearchFinancialMetricV1[],
  scope: 'all_periods' | 'latest_period',
): ResearchFinancialMetricRowV1[] {
  const calculated = calculateFinancialMetrics(state);
  const periods = scope === 'latest_period' ? calculated.periods.slice(-1) : calculated.periods;
  if (periods.length === 0) {
    const status = 'missing' as const;
    const reason = 'no_financial_statements_available';

    return metrics.map((metric) =>
      metricRow(state, name, null, {
        concept: metric,
        value: null,
        unit: FINANCIAL_METRIC_DEFINITIONS[metric].unit,
        status,
        formula: FINANCIAL_METRIC_DEFINITIONS[metric].formula,
        formulaVersion: FINANCIAL_FORMULA_VERSION,
        inputVersions: [],
        missingReason: reason,
      }),
    );
  }
  return periods.flatMap((period) =>
    metrics.map((metric) => metricRow(state, name, period.endDate, period.metrics[metric])),
  );
}

function metricRow(
  state: ResolvedFinancialState,
  name: string,
  reportPeriod: string | null,
  metric: FinancialMetricResult,
): ResearchFinancialMetricRowV1 {
  return {
    date: state.asOfDate,
    code: state.tsCode,
    name,
    applicability: state.applicability,
    report_period: reportPeriod,
    metric: metric.concept,
    value: metric.value,
    unit: metric.unit,
    status: metric.status,
    missing_reason: metric.missingReason ?? null,
    formula: metric.formula,
    formula_version: metric.formulaVersion,
    input_versions_json: JSON.stringify(metric.inputVersions),
  };
}

/**
 * 验证并去重请求指标，保持公开契约规定顺序和范围。
 *
 * Validate and deduplicate selected metrics under the public contract.
 */
function normalizeSelectedMetrics(
  input: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[],
): ResearchFinancialMetricV1[] {
  const metrics = typeof input === 'string' ? [input] : [...input];
  if (metrics.length === 0 || metrics.length > MAX_SELECTED_FINANCIAL_METRICS) {
    throw new Error(`Financial metrics must contain 1-${MAX_SELECTED_FINANCIAL_METRICS} items`);
  }
  if (new Set(metrics).size !== metrics.length) {
    throw new Error('Financial metrics must be unique');
  }
  const unknown = metrics.find((metric) => !FINANCIAL_METRIC_SET.has(metric));
  if (unknown) {
    throw new Error(`Unsupported financial metric: ${unknown}`);
  }
  return metrics;
}

function assertRowLimit(rows: number, limit: number, label: string): void {
  if (rows > limit) {
    throw new Error(`${label} contains ${rows} rows; the limit is ${limit}`);
  }
}

/**
 * 验证并规范化原始财报字段选择，拒绝未公开字段。
 *
 * Validate and normalize financial field selections against the public contract.
 */
export function normalizeFinancialFields(input?: string | string[]): Set<string> | undefined {
  if (input === undefined) {
    return undefined;
  }
  const fields = typeof input === 'string' ? [input] : input;
  const allowed = new Set<string>(RESEARCH_FINANCIAL_FIELDS_V1.map((field) => field.key));
  if (
    fields.length < 1 ||
    fields.length > 16 ||
    new Set(fields).size !== fields.length ||
    fields.some((field) => !allowed.has(field))
  ) {
    throw new Error('Select 1-16 unique mapped financial fields using statement_kind.field.');
  }
  return new Set(fields);
}

/**
 * 校验报告期起止范围与查询约束，避免无界财报读取。
 *
 * Validate reporting-period bounds and query limits before statement loading.
 */
export function validateFinancialReportRange(start?: string, end?: string): void {
  for (const date of [start, end]) {
    if (date !== undefined) {
      const parsed = new Date(
        date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8) + 'T00:00:00Z',
      );
      if (
        !/^\d{8}$/.test(date) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10).replaceAll('-', '') !== date
      ) {
        throw new Error('Financial dates must be valid YYYYMMDD dates.');
      }
    }
  }
  if (start && end && start > end) {
    throw new Error('report_start must not exceed report_end.');
  }
}
