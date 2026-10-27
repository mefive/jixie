import { createHash } from 'node:crypto';

import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import type { FinancialAvailabilityQuality, FinancialStatementKind } from './source-contract.js';

export const FINANCIAL_RESOLVER_VERSION = 2;

export type FinancialStatementReportType = '1' | '4' | '5';

/**
 * 记录财务缺失、修订与计算限制，供 SDK 解释。
 *
 * Describe financial missing data, revisions and calculation limits.
 */
export interface FinancialDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  endDate?: string;
  statementKind?: FinancialStatementKind;
  metric?: string;
}

/**
 * 保留财报版本与可得性证据，供历史状态追溯。
 *
 * Retain statement version and availability provenance.
 */
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

/**
 * 呈现历史时点选定的利润表版本及字段。
 *
 * Describe the income statement selected for an as-of date.
 */
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

/**
 * 呈现历史时点选定的资产负债表存量。
 *
 * Describe balance-sheet stocks selected for an as-of date.
 */
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

/**
 * 呈现历史时点选定的现金流量表流量。
 *
 * Describe cash-flow statement flows selected for an as-of date.
 */
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

/**
 * 统一三张表的已解析版本，供财务状态组合。
 *
 * Unify resolved statement variants for financial-state assembly.
 */
export type ResolvedFinancialStatement =
  | ResolvedIncomeStatement
  | ResolvedBalanceSheet
  | ResolvedCashFlowStatement;

/**
 * 组合某报告期可见的三张表与诊断。
 *
 * Collect visible statements and diagnostics for one reporting period.
 */
export interface ResolvedFinancialPeriod {
  endDate: string;
  income: ResolvedIncomeStatement | null;
  balanceSheet: ResolvedBalanceSheet | null;
  cashFlow: ResolvedCashFlowStatement | null;
}

/**
 * 提供财务状态对应的时点行情与估值。
 *
 * Supply dated prices and valuations accompanying financial state.
 */
export interface ResolvedFinancialMarketSnapshot {
  tradeDate: string;
  marketCapitalization: number | null;
  sourceIdentity: string;
}

/**
 * 汇总某证券某历史日可得的报表、行情和诊断。
 *
 * Collect an instrument's as-of statements, market snapshot and diagnostics.
 */
export interface ResolvedFinancialState {
  resolverVersion: number;
  tsCode: string;
  asOfDate: string;
  strictPit: true;
  applicability: 'industrial' | 'unknown';
  periods: ResolvedFinancialPeriod[];
  market: ResolvedFinancialMarketSnapshot | null;
  diagnostics: FinancialDiagnostic[];
}

/**
 * 按证券索引批量行情快照，避免逐股重复读取。
 *
 * Index batched market snapshots by instrument to avoid repeated reads.
 */
export interface BatchFinancialMarketSnapshot extends ResolvedFinancialMarketSnapshot {
  tsCode: string;
}

type FinancialResolverDatabase = Pick<
  Prisma,
  'financialIncomeStatement' | 'financialBalanceSheet' | 'financialCashFlowStatement' | 'dailyBasic'
>;
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

/**
 * 独立解析三张表在历史日期可用的版本，避免跨版本拼接造成未来信息。
 *
 * Resolve the independently versioned statements that were usable on a historical date.
 */
export async function resolveFinancialState(
  input: { tsCode: string; asOfDate: string },
  database: FinancialResolverDatabase = getDatabase(),
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
  const [incomeRows, balanceRows, cashFlowRows, market] = await Promise.all([
    database.financialIncomeStatement.findMany({ where: commonWhere }),
    database.financialBalanceSheet.findMany({ where: commonWhere }),
    database.financialCashFlowStatement.findMany({ where: commonWhere }),
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
    market: market
      ? {
          tradeDate: market.tradeDate,
          marketCapitalization: market.totalMv == null ? null : market.totalMv * 10_000,
          sourceIdentity: `daily_basic:${tsCode}:${market.tradeDate}`,
        }
      : null,
  });
}

/**
 * 以四次批量查询解析有界股票集合，避免逐证券重复查询。
 *
 * Resolve a bounded stock set with four database queries instead of one query sequence per stock.
 */
export async function resolveFinancialStates(
  input: {
    tsCodes: readonly string[];
    asOfDate: string;
    markets?: readonly BatchFinancialMarketSnapshot[];
    reportStart?: string;
    reportEnd?: string;
  },
  database: FinancialResolverDatabase = getDatabase(),
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
    endDate: {
      gte: input.reportStart ?? financialBatchLookbackStart(input.asOfDate),
      ...(input.reportEnd ? { lte: input.reportEnd } : {}),
    },
    compType: '1',
    reportType: { in: ['1', '4', '5'] },
  };
  const [incomeRows, balanceRows, cashFlowRows] = await Promise.all([
    database.financialIncomeStatement.findMany({ where: commonWhere }),
    database.financialBalanceSheet.findMany({ where: commonWhere }),
    database.financialCashFlowStatement.findMany({ where: commonWhere }),
  ]);
  const incomeByCode = groupByCode(incomeRows.map(mapIncome));
  const balanceByCode = groupByCode(balanceRows.map(mapBalance));
  const cashFlowByCode = groupByCode(cashFlowRows.map(mapCashFlow));
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
      market: marketByCode.get(tsCode) ?? null,
    }),
  );
}

/**
 * 组合指定时点可见的报表版本、市场快照和诊断，形成研究财务状态。
 *
 * Build an as-of financial state from visible statement versions, market snapshots and diagnostics.
 */
function buildFinancialState(input: {
  tsCode: string;
  asOfDate: string;
  incomeRows: ResolvedIncomeStatement[];
  balanceRows: ResolvedBalanceSheet[];
  cashFlowRows: ResolvedCashFlowStatement[];
  market: ResolvedFinancialMarketSnapshot | null;
}): ResolvedFinancialState {
  const { tsCode, asOfDate, incomeRows, balanceRows, cashFlowRows, market } = input;

  const diagnostics: FinancialDiagnostic[] = [];
  // 来源已按 compType=1 筛选，行业分类不再参与财务计算。
  // Source queries already require compType=1; industry classification is not an input.
  const applicability =
    incomeRows.length + balanceRows.length + cashFlowRows.length > 0 ? 'industrial' : 'unknown';

  const income = selectLatestStatementVersions(incomeRows, diagnostics);
  const balanceSheets = selectLatestStatementVersions(balanceRows, diagnostics);
  const cashFlows = selectLatestStatementVersions(cashFlowRows, diagnostics);
  const periods = combinePeriods(income, balanceSheets, cashFlows);
  if (periods.length === 0) {
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
    applicability,
    periods,
    market,
    diagnostics,
  };
}

/**
 * 按公告、可得日期和版本规则选择各报表最新可用来源。
 *
 * Select each statement's latest usable source under announcement, availability and version rules.
 */
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

/**
 * 提取三张表共用的来源与可得性元数据，供状态响应一致追溯。
 *
 * Extract shared statement provenance and availability metadata for consistent state responses.
 */
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

/**
 * 将资产负债表原始字段映射为已解析状态，保持存量口径。
 *
 * Map balance-sheet source fields into resolved financial state without changing stock semantics.
 */
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
