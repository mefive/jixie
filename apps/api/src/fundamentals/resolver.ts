import { createHash } from 'node:crypto';

import { prisma, type Prisma } from '../lib/prisma.js';
import { canonicalStockCode } from '../market/stock-identity.js';
import type { FinancialAvailabilityQuality, FinancialStatementKind } from './source-contract.js';

export const FINANCIAL_RESOLVER_VERSION = 1;

export type FinancialStatementReportType = '1' | '4' | '5';

export interface FinancialDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  endDate?: string;
  statementKind?: FinancialStatementKind;
  metric?: string;
}

export interface FinancialStatementVersionMetadata {
  id: string;
  source: string;
  contractVersion: number;
  statementKind: FinancialStatementKind;
  tsCode: string;
  endDate: string;
  announcementDate: string;
  availableDate: string;
  availabilityQuality: FinancialAvailabilityQuality;
  reportType: FinancialStatementReportType;
  compType: '1';
  updateFlag: string | null;
  sourceRowFingerprint: string;
}

export interface ResolvedIncomeStatement extends FinancialStatementVersionMetadata {
  statementKind: 'income';
  values: {
    totalRevenue: number | null;
    revenue: number | null;
    operCost: number | null;
    operateProfit: number | null;
    totalProfit: number | null;
    incomeTax: number | null;
    nIncome: number | null;
    nIncomeAttrP: number | null;
    ebit: number | null;
    rdExp: number | null;
    finExpIntExp: number | null;
  };
}

export interface ResolvedBalanceSheet extends FinancialStatementVersionMetadata {
  statementKind: 'balance_sheet';
  values: {
    moneyCap: number | null;
    tradAsset: number | null;
    notesReceiv: number | null;
    accountsReceiv: number | null;
    accountsReceivBill: number | null;
    othReceiv: number | null;
    othRcvTotal: number | null;
    inventories: number | null;
    prepayment: number | null;
    contractAssets: number | null;
    othCurAssets: number | null;
    totalCurAssets: number | null;
    fixAssets: number | null;
    fixAssetsTotal: number | null;
    cip: number | null;
    cipTotal: number | null;
    intanAssets: number | null;
    goodwill: number | null;
    deferTaxAssets: number | null;
    othNca: number | null;
    totalNca: number | null;
    totalAssets: number | null;
    notesPayable: number | null;
    acctPayable: number | null;
    accountsPay: number | null;
    advReceipts: number | null;
    contractLiab: number | null;
    payrollPayable: number | null;
    taxesPayable: number | null;
    othPayable: number | null;
    othPayTotal: number | null;
    stBorr: number | null;
    nonCurLiabDue1y: number | null;
    ltBorr: number | null;
    bondPayable: number | null;
    othCurLiab: number | null;
    totalCurLiab: number | null;
    othNcl: number | null;
    totalNcl: number | null;
    totalLiab: number | null;
    minorityInt: number | null;
    totalHldrEqyExcMinInt: number | null;
    totalShare: number | null;
  };
}

export interface ResolvedCashFlowStatement extends FinancialStatementVersionMetadata {
  statementKind: 'cash_flow';
  values: {
    nCashflowAct: number | null;
    cPayAcqConstFiolta: number | null;
    nCashflowInvAct: number | null;
    nCashFlowsFncAct: number | null;
    cPayDistDpcpIntExp: number | null;
    nIncrCashCashEqu: number | null;
    cCashEquBegPeriod: number | null;
    cCashEquEndPeriod: number | null;
    netProfit: number | null;
    deprFaCogaDpba: number | null;
    amortIntangAssets: number | null;
    freeCashflow: number | null;
  };
}

export type ResolvedFinancialStatement =
  | ResolvedIncomeStatement
  | ResolvedBalanceSheet
  | ResolvedCashFlowStatement;

export interface ResolvedFinancialPeriod {
  endDate: string;
  income: ResolvedIncomeStatement | null;
  balanceSheet: ResolvedBalanceSheet | null;
  cashFlow: ResolvedCashFlowStatement | null;
}

export interface ResolvedFinancialMarketSnapshot {
  tradeDate: string;
  marketCapitalization: number | null;
  sourceIdentity: string;
}

export interface ResolvedFinancialState {
  resolverVersion: number;
  tsCode: string;
  asOfDate: string;
  strictPit: true;
  industry: { l1Code: string; l1Name: string } | null;
  applicability: 'industrial' | 'unsupported_financial' | 'unknown';
  periods: ResolvedFinancialPeriod[];
  market: ResolvedFinancialMarketSnapshot | null;
  diagnostics: FinancialDiagnostic[];
}

export interface BatchFinancialMarketSnapshot extends ResolvedFinancialMarketSnapshot {
  tsCode: string;
}

type FinancialResolverDatabase = Pick<
  Prisma,
  | 'financialIncomeStatement'
  | 'financialBalanceSheet'
  | 'financialCashFlowStatement'
  | 'swIndustryMember'
  | 'dailyBasic'
>;

const FINANCIAL_INDUSTRY_CODES = new Set(['801780.SI', '801790.SI']);
const REPORT_TYPE_PRIORITY: Record<FinancialStatementReportType, number> = {
  '1': 2,
  '4': 3,
  '5': 1,
};
const QUALITY_PRIORITY: Record<FinancialAvailabilityQuality, number> = {
  exact: 2,
  conservative: 1,
  reconstructed: 0,
};

/** Resolve the independently versioned statements that were usable on a historical date. */
export async function resolveFinancialState(
  input: { tsCode: string; asOfDate: string },
  database: FinancialResolverDatabase = prisma,
): Promise<ResolvedFinancialState> {
  assertTsCode(input.tsCode);
  assertDate(input.asOfDate, 'asOfDate');
  const tsCode = canonicalStockCode(input.tsCode);
  const commonWhere = {
    tsCode,
    availableDate: { lte: input.asOfDate },
    compType: '1',
    reportType: { in: ['1', '4', '5'] },
  };
  const [incomeRows, balanceRows, cashFlowRows, industry, market] = await Promise.all([
    database.financialIncomeStatement.findMany({ where: commonWhere }),
    database.financialBalanceSheet.findMany({ where: commonWhere }),
    database.financialCashFlowStatement.findMany({ where: commonWhere }),
    database.swIndustryMember.findFirst({
      where: {
        tsCode,
        inDate: { lte: input.asOfDate },
        OR: [{ outDate: null }, { outDate: { gt: input.asOfDate } }],
      },
      orderBy: { inDate: 'desc' },
      select: { l1Code: true, l1Name: true },
    }),
    database.dailyBasic.findFirst({
      where: { tsCode, tradeDate: { lte: input.asOfDate } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true, totalMv: true },
    }),
  ]);

  return buildFinancialState({
    tsCode,
    asOfDate: input.asOfDate,
    incomeRows: incomeRows.map(mapIncome),
    balanceRows: balanceRows.map(mapBalance),
    cashFlowRows: cashFlowRows.map(mapCashFlow),
    industry,
    market: market
      ? {
          tradeDate: market.tradeDate,
          marketCapitalization: market.totalMv == null ? null : market.totalMv * 10_000,
          sourceIdentity: `daily_basic:${tsCode}:${market.tradeDate}`,
        }
      : null,
  });
}

/** Resolve a bounded stock set with four database queries instead of one query sequence per stock. */
export async function resolveFinancialStates(
  input: {
    tsCodes: readonly string[];
    asOfDate: string;
    markets?: readonly BatchFinancialMarketSnapshot[];
  },
  database: FinancialResolverDatabase = prisma,
): Promise<ResolvedFinancialState[]> {
  assertDate(input.asOfDate, 'asOfDate');
  const tsCodes = sortedUnique(
    input.tsCodes.map((tsCode) => {
      assertTsCode(tsCode);
      return canonicalStockCode(tsCode);
    }),
  );
  if (tsCodes.length === 0) {
    return [];
  }
  const commonWhere = {
    tsCode: { in: tsCodes },
    availableDate: { lte: input.asOfDate },
    endDate: { gte: financialBatchLookbackStart(input.asOfDate) },
    compType: '1',
    reportType: { in: ['1', '4', '5'] },
  };
  const [incomeRows, balanceRows, cashFlowRows, industries] = await Promise.all([
    database.financialIncomeStatement.findMany({ where: commonWhere }),
    database.financialBalanceSheet.findMany({ where: commonWhere }),
    database.financialCashFlowStatement.findMany({ where: commonWhere }),
    database.swIndustryMember.findMany({
      where: {
        tsCode: { in: tsCodes },
        inDate: { lte: input.asOfDate },
        OR: [{ outDate: null }, { outDate: { gt: input.asOfDate } }],
      },
      orderBy: { inDate: 'desc' },
      select: { tsCode: true, l1Code: true, l1Name: true },
    }),
  ]);
  const incomeByCode = groupByCode(incomeRows.map(mapIncome));
  const balanceByCode = groupByCode(balanceRows.map(mapBalance));
  const cashFlowByCode = groupByCode(cashFlowRows.map(mapCashFlow));
  const industryByCode = new Map<string, { l1Code: string; l1Name: string }>();
  for (const industry of industries) {
    if (!industryByCode.has(industry.tsCode)) {
      industryByCode.set(industry.tsCode, industry);
    }
  }
  const marketByCode = new Map(
    (input.markets ?? []).map(({ tsCode, ...market }) => [canonicalStockCode(tsCode), market]),
  );

  return tsCodes.map((tsCode) =>
    buildFinancialState({
      tsCode,
      asOfDate: input.asOfDate,
      incomeRows: incomeByCode.get(tsCode) ?? [],
      balanceRows: balanceByCode.get(tsCode) ?? [],
      cashFlowRows: cashFlowByCode.get(tsCode) ?? [],
      industry: industryByCode.get(tsCode) ?? null,
      market: marketByCode.get(tsCode) ?? null,
    }),
  );
}

function buildFinancialState(input: {
  tsCode: string;
  asOfDate: string;
  incomeRows: ResolvedIncomeStatement[];
  balanceRows: ResolvedBalanceSheet[];
  cashFlowRows: ResolvedCashFlowStatement[];
  industry: { l1Code: string; l1Name: string } | null;
  market: ResolvedFinancialMarketSnapshot | null;
}): ResolvedFinancialState {
  const { tsCode, asOfDate, incomeRows, balanceRows, cashFlowRows, industry, market } = input;

  const diagnostics: FinancialDiagnostic[] = [];
  const applicability = industry
    ? FINANCIAL_INDUSTRY_CODES.has(industry.l1Code)
      ? 'unsupported_financial'
      : 'industrial'
    : incomeRows.length + balanceRows.length + cashFlowRows.length > 0
      ? 'industrial'
      : 'unknown';
  if (applicability === 'unsupported_financial') {
    diagnostics.push({
      code: 'unsupported_financial_company',
      severity: 'error',
      message: `Industrial-company financial metrics do not apply to ${industry?.l1Name ?? tsCode}.`,
    });
  }

  const income = selectLatestStatementVersions(incomeRows, diagnostics);
  const balanceSheets = selectLatestStatementVersions(balanceRows, diagnostics);
  const cashFlows = selectLatestStatementVersions(cashFlowRows, diagnostics);
  const periods = combinePeriods(income, balanceSheets, cashFlows);
  if (periods.length === 0 && applicability !== 'unsupported_financial') {
    diagnostics.push({
      code: 'no_financial_statements_available',
      severity: 'warning',
      message: `No strict-PIT industrial statements are available by ${asOfDate}.`,
    });
  }

  return {
    resolverVersion: FINANCIAL_RESOLVER_VERSION,
    tsCode,
    asOfDate,
    strictPit: true,
    industry,
    applicability,
    periods: applicability === 'unsupported_financial' ? [] : periods,
    market,
    diagnostics,
  };
}

export function selectLatestStatementVersions<Statement extends ResolvedFinancialStatement>(
  rows: readonly Statement[],
  diagnostics: FinancialDiagnostic[] = [],
): Statement[] {
  const byPeriod = new Map<string, Statement[]>();
  for (const row of rows) {
    const group = byPeriod.get(row.endDate) ?? [];
    group.push(row);
    byPeriod.set(row.endDate, group);
  }

  const selected: Statement[] = [];
  for (const [endDate, periodRows] of [...byPeriod].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const eligible = periodRows.filter((row) => row.availabilityQuality !== 'reconstructed');
    const reconstructed = periodRows.length - eligible.length;
    if (reconstructed > 0) {
      diagnostics.push({
        code: 'reconstructed_versions_excluded',
        severity: 'info',
        message: `${reconstructed} reconstructed version(s) were excluded from strict PIT selection.`,
        endDate,
        statementKind: periodRows[0].statementKind,
      });
    }
    if (eligible.length === 0) {
      diagnostics.push({
        code: 'reconstructed_only_period',
        severity: 'warning',
        message: 'Only reconstructed statement versions are available for this period.',
        endDate,
        statementKind: periodRows[0].statementKind,
      });
      continue;
    }

    const latestDate = eligible
      .map((row) => row.availableDate)
      .sort()
      .at(-1)!;
    const latestRows = eligible.filter((row) => row.availableDate === latestDate);
    const reportPriority = Math.max(
      ...latestRows.map((row) => REPORT_TYPE_PRIORITY[row.reportType]),
    );
    const preferredReportRows = latestRows.filter(
      (row) => REPORT_TYPE_PRIORITY[row.reportType] === reportPriority,
    );
    const qualityPriority = Math.max(
      ...preferredReportRows.map((row) => QUALITY_PRIORITY[row.availabilityQuality]),
    );
    const finalists = preferredReportRows.filter(
      (row) => QUALITY_PRIORITY[row.availabilityQuality] === qualityPriority,
    );
    const valueGroups = new Map<string, Statement[]>();
    for (const row of finalists) {
      const fingerprint = statementValuesFingerprint(row);
      const group = valueGroups.get(fingerprint) ?? [];
      group.push(row);
      valueGroups.set(fingerprint, group);
    }
    if (valueGroups.size > 1) {
      diagnostics.push({
        code: 'ambiguous_latest_statement_version',
        severity: 'error',
        message: 'Several equally ranked statement versions contain different values.',
        endDate,
        statementKind: periodRows[0].statementKind,
      });
      continue;
    }

    const chosen = [...finalists].sort((left, right) =>
      left.sourceRowFingerprint.localeCompare(right.sourceRowFingerprint),
    )[0];
    selected.push(chosen);
    if (finalists.length > 1) {
      diagnostics.push({
        code: 'equivalent_statement_versions_collapsed',
        severity: 'info',
        message: `${finalists.length} equally ranked versions had identical typed values.`,
        endDate,
        statementKind: periodRows[0].statementKind,
      });
    }
  }
  return selected;
}

function combinePeriods(
  income: ResolvedIncomeStatement[],
  balanceSheets: ResolvedBalanceSheet[],
  cashFlows: ResolvedCashFlowStatement[],
): ResolvedFinancialPeriod[] {
  const incomeByPeriod = new Map(income.map((row) => [row.endDate, row]));
  const balanceByPeriod = new Map(balanceSheets.map((row) => [row.endDate, row]));
  const cashByPeriod = new Map(cashFlows.map((row) => [row.endDate, row]));
  const dates = [
    ...new Set([...incomeByPeriod.keys(), ...balanceByPeriod.keys(), ...cashByPeriod.keys()]),
  ];
  dates.sort();
  return dates.map((endDate) => ({
    endDate,
    income: incomeByPeriod.get(endDate) ?? null,
    balanceSheet: balanceByPeriod.get(endDate) ?? null,
    cashFlow: cashByPeriod.get(endDate) ?? null,
  }));
}

function statementValuesFingerprint(row: ResolvedFinancialStatement): string {
  return createHash('sha256').update(JSON.stringify(row.values)).digest('hex');
}

function commonMetadata(
  row: {
    id: string;
    source: string;
    contractVersion: number;
    tsCode: string;
    endDate: string;
    announcementDate: string;
    availableDate: string;
    availabilityQuality: string;
    reportType: string;
    compType: string;
    updateFlag: string | null;
    sourceRowFingerprint: string;
  },
  statementKind: FinancialStatementKind,
): FinancialStatementVersionMetadata {
  if (!isAvailabilityQuality(row.availabilityQuality)) {
    throw new Error(`Unknown financial availability quality: ${row.availabilityQuality}`);
  }
  if (!isReportType(row.reportType) || row.compType !== '1') {
    throw new Error(`Unsupported financial statement scope: ${row.reportType}/${row.compType}`);
  }
  return {
    id: row.id,
    source: row.source,
    contractVersion: row.contractVersion,
    statementKind,
    tsCode: row.tsCode,
    endDate: row.endDate,
    announcementDate: row.announcementDate,
    availableDate: row.availableDate,
    availabilityQuality: row.availabilityQuality,
    reportType: row.reportType,
    compType: row.compType,
    updateFlag: row.updateFlag,
    sourceRowFingerprint: row.sourceRowFingerprint,
  };
}

function mapIncome(
  row: Awaited<
    ReturnType<FinancialResolverDatabase['financialIncomeStatement']['findMany']>
  >[number],
): ResolvedIncomeStatement {
  return {
    ...commonMetadata(row, 'income'),
    statementKind: 'income',
    values: {
      totalRevenue: row.totalRevenue,
      revenue: row.revenue,
      operCost: row.operCost,
      operateProfit: row.operateProfit,
      totalProfit: row.totalProfit,
      incomeTax: row.incomeTax,
      nIncome: row.nIncome,
      nIncomeAttrP: row.nIncomeAttrP,
      ebit: row.ebit,
      rdExp: row.rdExp,
      finExpIntExp: row.finExpIntExp,
    },
  };
}

function mapBalance(
  row: Awaited<ReturnType<FinancialResolverDatabase['financialBalanceSheet']['findMany']>>[number],
): ResolvedBalanceSheet {
  return {
    ...commonMetadata(row, 'balance_sheet'),
    statementKind: 'balance_sheet',
    values: {
      moneyCap: row.moneyCap,
      tradAsset: row.tradAsset,
      notesReceiv: row.notesReceiv,
      accountsReceiv: row.accountsReceiv,
      accountsReceivBill: row.accountsReceivBill,
      othReceiv: row.othReceiv,
      othRcvTotal: row.othRcvTotal,
      inventories: row.inventories,
      prepayment: row.prepayment,
      contractAssets: row.contractAssets,
      othCurAssets: row.othCurAssets,
      totalCurAssets: row.totalCurAssets,
      fixAssets: row.fixAssets,
      fixAssetsTotal: row.fixAssetsTotal,
      cip: row.cip,
      cipTotal: row.cipTotal,
      intanAssets: row.intanAssets,
      goodwill: row.goodwill,
      deferTaxAssets: row.deferTaxAssets,
      othNca: row.othNca,
      totalNca: row.totalNca,
      totalAssets: row.totalAssets,
      notesPayable: row.notesPayable,
      acctPayable: row.acctPayable,
      accountsPay: row.accountsPay,
      advReceipts: row.advReceipts,
      contractLiab: row.contractLiab,
      payrollPayable: row.payrollPayable,
      taxesPayable: row.taxesPayable,
      othPayable: row.othPayable,
      othPayTotal: row.othPayTotal,
      stBorr: row.stBorr,
      nonCurLiabDue1y: row.nonCurLiabDue1y,
      ltBorr: row.ltBorr,
      bondPayable: row.bondPayable,
      othCurLiab: row.othCurLiab,
      totalCurLiab: row.totalCurLiab,
      othNcl: row.othNcl,
      totalNcl: row.totalNcl,
      totalLiab: row.totalLiab,
      minorityInt: row.minorityInt,
      totalHldrEqyExcMinInt: row.totalHldrEqyExcMinInt,
      totalShare: row.totalShare,
    },
  };
}

function mapCashFlow(
  row: Awaited<
    ReturnType<FinancialResolverDatabase['financialCashFlowStatement']['findMany']>
  >[number],
): ResolvedCashFlowStatement {
  return {
    ...commonMetadata(row, 'cash_flow'),
    statementKind: 'cash_flow',
    values: {
      nCashflowAct: row.nCashflowAct,
      cPayAcqConstFiolta: row.cPayAcqConstFiolta,
      nCashflowInvAct: row.nCashflowInvAct,
      nCashFlowsFncAct: row.nCashFlowsFncAct,
      cPayDistDpcpIntExp: row.cPayDistDpcpIntExp,
      nIncrCashCashEqu: row.nIncrCashCashEqu,
      cCashEquBegPeriod: row.cCashEquBegPeriod,
      cCashEquEndPeriod: row.cCashEquEndPeriod,
      netProfit: row.netProfit,
      deprFaCogaDpba: row.deprFaCogaDpba,
      amortIntangAssets: row.amortIntangAssets,
      freeCashflow: row.freeCashflow,
    },
  };
}

function isAvailabilityQuality(value: string): value is FinancialAvailabilityQuality {
  return value === 'exact' || value === 'conservative' || value === 'reconstructed';
}

function isReportType(value: string): value is FinancialStatementReportType {
  return value === '1' || value === '4' || value === '5';
}

function groupByCode<Row extends { tsCode: string }>(rows: Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const group = grouped.get(row.tsCode) ?? [];
    group.push(row);
    grouped.set(row.tsCode, group);
  }
  return grouped;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function financialBatchLookbackStart(asOfDate: string): string {
  return `${String(Number(asOfDate.slice(0, 4)) - 5).padStart(4, '0')}${asOfDate.slice(4)}`;
}

function assertDate(value: string, field: string): void {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Financial resolver ${field} must use YYYYMMDD`);
  }
}

function assertTsCode(value: string): void {
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(value)) {
    throw new Error(`Invalid A-share code: ${value}`);
  }
}
