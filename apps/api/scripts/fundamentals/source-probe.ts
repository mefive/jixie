import { TushareError, type TushareRow } from '../../src/tushare/client.js';
import {
  financialStatementAnnouncementIdentity,
  financialStatementPeriodIdentity,
  financialStatementValuesFingerprint,
  normalizeFinancialStatementSourceRow,
  type FinancialStatementKind,
} from '../../src/fundamentals/source-contract.js';

export type FundamentalSourceProbeStatus =
  | 'ok'
  | 'empty'
  | 'permission_denied'
  | 'request_error'
  | 'network_error';

export interface FundamentalSourceProbeClient {
  call(apiName: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface FundamentalSourceProbeOptions {
  tsCode: string;
  startDate: string;
  period: string;
}

export interface FundamentalSourceProbeResult {
  probeName: string;
  apiName: string;
  status: FundamentalSourceProbeStatus;
  rowCount: number;
  fields: string[];
  historyStart?: string;
  historyEnd?: string;
  duplicateAnnouncementGroups?: number;
  ambiguousSameDateVersionGroups?: number;
  datedRevisionGroups?: number;
  pagination?: {
    pageSize: number;
    firstPageRows: number;
    secondPageRows: number;
    distinctPageBoundary: boolean;
  };
  errorCode?: number;
  errorMessage?: string;
}

export interface FundamentalSourceProbeDefinition {
  probeName?: string;
  apiName: string;
  statementKind?: FinancialStatementKind;
  params: (options: FundamentalSourceProbeOptions) => Record<string, unknown>;
  paginate?: true;
}

const PAGE_SIZE = 100;

export const FUNDAMENTAL_SOURCE_PROBES: readonly FundamentalSourceProbeDefinition[] = [
  statementProbe('income', 'income'),
  statementProbe('balancesheet', 'balance_sheet'),
  statementProbe('cashflow', 'cash_flow'),
  statementReportTypeProbe('income', 'income', '4'),
  statementReportTypeProbe('income', 'income', '5'),
  statementReportTypeProbe('balancesheet', 'balance_sheet', '4'),
  statementReportTypeProbe('balancesheet', 'balance_sheet', '5'),
  statementReportTypeProbe('cashflow', 'cash_flow', '4'),
  statementReportTypeProbe('cashflow', 'cash_flow', '5'),
  statementVipProbe('income_vip', 'income'),
  statementVipProbe('balancesheet_vip', 'balance_sheet'),
  statementVipProbe('cashflow_vip', 'cash_flow'),
  {
    apiName: 'fina_indicator',
    params: ({ tsCode, startDate }) => ({ ts_code: tsCode, start_date: startDate }),
  },
  {
    apiName: 'fina_indicator_vip',
    params: ({ period }) => ({ period }),
    paginate: true,
  },
  {
    apiName: 'disclosure_date',
    params: ({ tsCode }) => ({ ts_code: tsCode }),
  },
  {
    apiName: 'fina_mainbz',
    params: ({ tsCode, period }) => ({ ts_code: tsCode, period, type: 'P' }),
  },
] as const;

/**
 * Bounded, read-only probes for the valuation-fundamental source contract. VIP endpoints read two
 * small pages to prove offset pagination without downloading a whole market period.
 */
export async function probeFundamentalSources(
  client: FundamentalSourceProbeClient,
  options: FundamentalSourceProbeOptions,
  definitions: readonly FundamentalSourceProbeDefinition[] = FUNDAMENTAL_SOURCE_PROBES,
): Promise<FundamentalSourceProbeResult[]> {
  const results: FundamentalSourceProbeResult[] = [];
  for (const definition of definitions) {
    try {
      const params = definition.params(options);
      const firstPage = await client.call(
        definition.apiName,
        definition.paginate ? { ...params, limit: PAGE_SIZE, offset: 0 } : params,
      );
      const secondPage = definition.paginate
        ? await client.call(definition.apiName, {
            ...params,
            limit: PAGE_SIZE,
            offset: PAGE_SIZE,
          })
        : [];
      results.push(summarize(definition, firstPage, secondPage));
    } catch (error) {
      results.push(errorResult(definition, error));
    }
  }
  return results;
}

function summarize(
  definition: FundamentalSourceProbeDefinition,
  firstPage: TushareRow[],
  secondPage: TushareRow[],
): FundamentalSourceProbeResult {
  const rows = definition.paginate ? [...firstPage, ...secondPage] : firstPage;
  const dates = rows
    .map((row) => row.end_date)
    .filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number',
    )
    .map(String)
    .sort();
  const result: FundamentalSourceProbeResult = {
    probeName: definition.probeName ?? definition.apiName,
    apiName: definition.apiName,
    status: rows.length > 0 ? 'ok' : 'empty',
    rowCount: rows.length,
    fields: rows[0] ? Object.keys(rows[0]) : [],
  };
  if (dates.length > 0) {
    result.historyStart = dates[0];
    result.historyEnd = dates.at(-1);
  }
  if (definition.statementKind && rows.length > 0) {
    const normalized = rows.map((row) =>
      normalizeFinancialStatementSourceRow(definition.statementKind!, row),
    );
    const announcementGroups = groupBy(normalized, financialStatementAnnouncementIdentity);
    const duplicateGroups = [...announcementGroups.values()].filter((group) => group.length > 1);
    result.duplicateAnnouncementGroups = duplicateGroups.length;
    result.ambiguousSameDateVersionGroups = duplicateGroups.filter(
      (group) => new Set(group.map(financialStatementValuesFingerprint)).size > 1,
    ).length;
    const periodGroups = groupBy(normalized, financialStatementPeriodIdentity);
    result.datedRevisionGroups = [...periodGroups.values()].filter((group) => {
      const actualDates = new Set(group.map((row) => row.fAnnDate ?? row.annDate));
      const values = new Set(group.map(financialStatementValuesFingerprint));
      return actualDates.size > 1 && values.size > 1;
    }).length;
  }
  if (definition.paginate) {
    result.pagination = {
      pageSize: PAGE_SIZE,
      firstPageRows: firstPage.length,
      secondPageRows: secondPage.length,
      distinctPageBoundary:
        firstPage.length > 0 &&
        secondPage.length > 0 &&
        JSON.stringify(firstPage.at(-1)) !== JSON.stringify(secondPage[0]),
    };
  }
  return result;
}

function errorResult(
  definition: FundamentalSourceProbeDefinition,
  error: unknown,
): FundamentalSourceProbeResult {
  const probeName = definition.probeName ?? definition.apiName;
  if (error instanceof TushareError) {
    return {
      probeName,
      apiName: definition.apiName,
      status: permissionFailure(error) ? 'permission_denied' : 'request_error',
      rowCount: 0,
      fields: [],
      errorCode: error.code,
      errorMessage: error.apiMsg,
    };
  }
  return {
    probeName,
    apiName: definition.apiName,
    status: 'network_error',
    rowCount: 0,
    fields: [],
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function statementProbe(
  apiName: string,
  statementKind: FinancialStatementKind,
): FundamentalSourceProbeDefinition {
  return {
    apiName,
    statementKind,
    params: ({ tsCode, startDate }) => ({ ts_code: tsCode, start_date: startDate }),
  };
}

function statementVipProbe(
  apiName: string,
  statementKind: FinancialStatementKind,
): FundamentalSourceProbeDefinition {
  return {
    apiName,
    statementKind,
    params: ({ period }) => ({ period }),
    paginate: true,
  };
}

function statementReportTypeProbe(
  apiName: string,
  statementKind: FinancialStatementKind,
  reportType: '4' | '5',
): FundamentalSourceProbeDefinition {
  return {
    apiName,
    probeName: `${apiName}:report_type=${reportType}`,
    statementKind,
    params: ({ tsCode, startDate }) => ({
      ts_code: tsCode,
      start_date: startDate,
      report_type: reportType,
    }),
  };
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const identity = key(row);
    const group = groups.get(identity) ?? [];
    group.push(row);
    groups.set(identity, group);
  }
  return groups;
}

function permissionFailure(error: TushareError): boolean {
  return error.code === 40203 || /权限|积分|permission/i.test(error.apiMsg);
}
