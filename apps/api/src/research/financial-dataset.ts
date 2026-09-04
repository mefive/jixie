import { RESEARCH_FINANCIAL_METRICS_V1, type ResearchFinancialMetricV1 } from '@jixie/shared';
import type { PrismaClient } from '@prisma/client';

import {
  FINANCIAL_FORMULA_VERSION,
  FINANCIAL_METRIC_DEFINITIONS,
  calculateFinancialMetrics,
  type FinancialMetricResult,
} from '../fundamentals/metrics.js';
import {
  resolveFinancialState,
  resolveFinancialStates,
  type ResolvedFinancialState,
  type ResolvedFinancialStatement,
} from '../fundamentals/resolver.js';
import { prisma } from '../lib/prisma.js';
import {
  loadResearchCrossSection,
  loadResearchPanel,
  type ResearchCrossSectionRequestV1,
  type ResearchEquityDatasetRowV1,
  type ResearchPanelRequestV1,
} from './equity-dataset.js';

const MAX_SELECTED_FINANCIAL_METRICS = 8;
const MAX_FINANCIAL_STATEMENT_ROWS = 10_000;
const MAX_FINANCIAL_METRIC_ROWS = 10_000;
const MAX_FINANCIAL_CROSS_SECTION_ROWS = 50_000;
const MAX_FINANCIAL_PANEL_ROWS = 100_000;
const FINANCIAL_METRIC_SET = new Set<string>(RESEARCH_FINANCIAL_METRICS_V1);

export interface ResearchSingleFinancialRequestV1 {
  identifier: string;
  as_of: string;
}

export interface ResearchFinancialCrossSectionRequestV1 extends ResearchCrossSectionRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

export interface ResearchFinancialPanelRequestV1 extends ResearchPanelRequestV1 {
  metrics: ResearchFinancialMetricV1 | ResearchFinancialMetricV1[];
}

export interface ResearchFinancialStatementRowV1 {
  as_of_date: string;
  code: string;
  industry: string | null;
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

export interface ResearchFinancialMetricRowV1 {
  date: string;
  code: string;
  name: string;
  industry: string | null;
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

/** Return the strict-PIT statement state as one stable, typed long table. */
export async function loadResearchFinancialStatements(
  request: ResearchSingleFinancialRequestV1,
  database: PrismaClient = prisma,
): Promise<ResearchFinancialStatementRowV1[]> {
  const state = await resolveFinancialState(
    { tsCode: request.identifier, asOfDate: request.as_of },
    database,
  );
  if (state.applicability === 'unsupported_financial') {
    throw new Error('Industrial-company financial statements do not apply to financial companies');
  }
  const rows = state.periods.flatMap((period) =>
    [period.income, period.balanceSheet, period.cashFlow].flatMap((statement) =>
      statement ? statementRows(state, statement) : [],
    ),
  );
  assertRowLimit(rows.length, MAX_FINANCIAL_STATEMENT_ROWS, 'financial statement');
  return rows;
}

/** Return all M2 metrics known for one stock on a historical date. */
export async function loadResearchFinancialMetrics(
  request: ResearchSingleFinancialRequestV1,
  database: PrismaClient = prisma,
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

/** Return one bounded PIT universe with a constant number of financial database queries. */
export async function loadResearchFinancialCrossSection(
  request: ResearchFinancialCrossSectionRequestV1,
  database: PrismaClient = prisma,
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

/** Return bounded historical month-end financial snapshots without current-data backfill. */
export async function loadResearchFinancialPanel(
  request: ResearchFinancialPanelRequestV1,
  database: PrismaClient = prisma,
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
    industry: state.industry?.l1Name ?? null,
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

function metricRowsForState(
  state: ResolvedFinancialState,
  name: string,
  metrics: ResearchFinancialMetricV1[],
  scope: 'all_periods' | 'latest_period',
): ResearchFinancialMetricRowV1[] {
  const calculated = calculateFinancialMetrics(state);
  const periods = scope === 'latest_period' ? calculated.periods.slice(-1) : calculated.periods;
  if (periods.length === 0) {
    const status =
      state.applicability === 'unsupported_financial' ? 'not_applicable' : ('missing' as const);
    const reason =
      state.applicability === 'unsupported_financial'
        ? 'unsupported_financial_company'
        : 'no_financial_statements_available';
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
    industry: state.industry?.l1Name ?? null,
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
