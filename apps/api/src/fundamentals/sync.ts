import type { TradeDate, TsCode } from '@jixie/shared';
import { ulid } from 'ulid';

import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { canonicalStockCode } from '../market/stock-identity.js';
import {
  balanceSheet,
  balanceSheetVip,
  cashFlowStatement,
  cashFlowStatementVip,
  incomeStatement,
  incomeStatementVip,
  type BalanceSheetRow,
  type CashFlowStatementRow,
  type FinancialStatementReportType,
  type IncomeStatementRow,
} from '../tushare/api.js';
import type { TushareClient, TushareRow, TushareValue } from '../tushare/client.js';
import { log } from '../util/log.js';
import {
  FINANCIAL_SOURCE_CONTRACT_VERSION,
  isV1IndustrialConsolidatedStatement,
  normalizeFinancialStatementSourceRow,
  resolveFinancialAvailability,
  type FinancialCorrectionEvidence,
  type FinancialStatementKind,
  type FinancialStatementSourceRow,
} from './source-contract.js';

export interface FinancialStatementSyncSummary {
  requested: number;
  skipped: number;
  processed: number;
  changed: number;
  created: number;
  updated: number;
  deleted: number;
}

export interface FinancialStatementStockSyncOptions {
  startDate: string;
  endDate: string;
  onCodeComplete?: (code: string) => Promise<void> | void;
}

export async function storeFinancialCorrectionEvidence(
  evidence: readonly FinancialCorrectionEvidence[],
  observedAt = new Date(),
  database: CorrectionEvidenceDatabase = prisma,
): Promise<number> {
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error('Financial correction evidence has invalid observedAt');
  }

  for (const item of evidence) {
    assertDate(item.publishedDate, 'evidence publishedDate');
    assertTsCode(item.tsCode);
    if (item.affectedPeriods.length === 0) {
      throw new Error(`Financial correction evidence ${item.sourceId} has no verified periods`);
    }
    for (const period of item.affectedPeriods) {
      assertDate(period, 'evidence affected period');
    }
    const publishedAt = new Date(item.publishedAt);
    if (!Number.isFinite(publishedAt.getTime())) {
      throw new Error(`Financial correction evidence ${item.sourceId} has invalid publishedAt`);
    }
    const data = {
      source: item.source,
      sourceId: item.sourceId,
      tsCode: canonicalStockCode(item.tsCode),
      publishedAt,
      publishedDate: item.publishedDate,
      title: item.title,
      documentUrl: item.documentUrl,
      affectedPeriods: [...item.affectedPeriods],
      sourceFingerprint: item.sourceFingerprint,
      observedAt,
    };
    await database.financialCorrectionEvidence.upsert({
      where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
      create: { id: ulid(), ...data },
      update: data,
    });
    for (const period of item.affectedPeriods) {
      const where = {
        tsCode: canonicalStockCode(item.tsCode),
        endDate: period,
        announcementDate: item.publishedDate,
      };
      const exactData = {
        availabilityQuality: 'exact',
        evidenceSource: 'cninfo_announcement',
        evidenceId: item.sourceId,
      };
      await Promise.all([
        attachEvidenceToUnambiguousVersion(
          () => database.financialIncomeStatement.findMany({ where, select: { id: true } }),
          (id) => database.financialIncomeStatement.update({ where: { id }, data: exactData }),
        ),
        attachEvidenceToUnambiguousVersion(
          () => database.financialBalanceSheet.findMany({ where, select: { id: true } }),
          (id) => database.financialBalanceSheet.update({ where: { id }, data: exactData }),
        ),
        attachEvidenceToUnambiguousVersion(
          () => database.financialCashFlowStatement.findMany({ where, select: { id: true } }),
          (id) => database.financialCashFlowStatement.update({ where: { id }, data: exactData }),
        ),
      ]);
    }
  }
  return evidence.length;
}

interface FinancialStatementBatch {
  income: IncomeStatementRow[];
  balanceSheet: BalanceSheetRow[];
  cashFlow: CashFlowStatementRow[];
}

interface PersistedFinancialStatementChanges {
  created: number;
  changedCodes: Set<string>;
}

type FinancialStatementDatabase = Pick<
  Prisma,
  | 'tradeCal'
  | 'financialCorrectionEvidence'
  | 'financialIncomeStatement'
  | 'financialBalanceSheet'
  | 'financialCashFlowStatement'
>;

type CorrectionEvidenceDatabase = Pick<
  Prisma,
  | 'financialCorrectionEvidence'
  | 'financialIncomeStatement'
  | 'financialBalanceSheet'
  | 'financialCashFlowStatement'
>;

const FINANCIAL_REPORT_TYPES: readonly FinancialStatementReportType[] = ['1', '4', '5'];
const DATABASE_BATCH_SIZE = 250;

/**
 * Backfills the three append-only statement tables by report period. Each report type is requested
 * explicitly because Tushare's default response omits adjusted comparative versions.
 */
export async function syncFinancialStatementsVip(
  client: TushareClient,
  periods: string[],
  options: { onPeriodComplete?: (period: string) => Promise<void> | void } = {},
  database: FinancialStatementDatabase = prisma,
): Promise<FinancialStatementSyncSummary> {
  const summary = emptyFinancialStatementSyncSummary(periods.length);

  for (const period of periods) {
    assertDate(period, 'period');
    const batch = await fetchFinancialStatementPeriod(client, period as TradeDate);
    const changes = await persistFinancialStatementBatch(batch, database);
    summary.processed++;
    summary.created += changes.created;
    summary.changed += changes.changedCodes.size;
    await options.onPeriodComplete?.(period);
    log(
      `  statement VIP ${summary.processed}/${periods.length} (${period}) ${batch.income.length}/${batch.balanceSheet.length}/${batch.cashFlow.length} income/balance/cash rows, ${changes.created} new versions`,
    );
  }

  log('syncFinancialStatementsVip complete');
  return summary;
}

/**
 * Repairs selected stocks through bounded announcement-date windows. A full-history standard API
 * call can stop at the provider row cap, so this path never requests an unbounded history.
 */
export async function syncFinancialStatementsByStock(
  client: TushareClient,
  codes: string[],
  options: FinancialStatementStockSyncOptions,
  database: FinancialStatementDatabase = prisma,
): Promise<FinancialStatementSyncSummary> {
  assertDate(options.startDate, 'startDate');
  assertDate(options.endDate, 'endDate');
  if (options.startDate > options.endDate) {
    throw new Error('Financial statement repair startDate must not exceed endDate');
  }

  const windows = financialStatementDateWindows(options.startDate, options.endDate);
  const summary = emptyFinancialStatementSyncSummary(codes.length);
  for (const code of codes) {
    assertTsCode(code);
    const batch: FinancialStatementBatch = { income: [], balanceSheet: [], cashFlow: [] };
    for (const window of windows) {
      const current = await fetchFinancialStatementStockWindow(
        client,
        code as TsCode,
        window.startDate as TradeDate,
        window.endDate as TradeDate,
      );
      batch.income.push(...current.income);
      batch.balanceSheet.push(...current.balanceSheet);
      batch.cashFlow.push(...current.cashFlow);
    }

    const changes = await persistFinancialStatementBatch(batch, database);
    summary.processed++;
    summary.created += changes.created;
    summary.changed += changes.changedCodes.size;
    await options.onCodeComplete?.(code);
    log(
      `  statement repair ${summary.processed}/${codes.length} (${code}) ${changes.created} new versions`,
    );
  }

  log('syncFinancialStatementsByStock complete');
  return summary;
}

export function financialStatementDateWindows(
  startDate: string,
  endDate: string,
): Array<{ startDate: string; endDate: string }> {
  assertDate(startDate, 'startDate');
  assertDate(endDate, 'endDate');
  if (startDate > endDate) {
    throw new Error('Financial statement window startDate must not exceed endDate');
  }

  const windows: Array<{ startDate: string; endDate: string }> = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    windows.push({
      startDate: year === Number(startDate.slice(0, 4)) ? startDate : `${year}0101`,
      endDate: year === Number(endDate.slice(0, 4)) ? endDate : `${year}1231`,
    });
  }
  return windows;
}

async function fetchFinancialStatementPeriod(
  client: TushareClient,
  period: TradeDate,
): Promise<FinancialStatementBatch> {
  const batch: FinancialStatementBatch = { income: [], balanceSheet: [], cashFlow: [] };
  for (const reportType of FINANCIAL_REPORT_TYPES) {
    const [incomeRows, balanceRows, cashRows] = await Promise.all([
      incomeStatementVip(client, period, reportType),
      balanceSheetVip(client, period, reportType),
      cashFlowStatementVip(client, period, reportType),
    ]);
    assertExpectedRows(incomeRows, period, reportType, 'income_vip');
    assertExpectedRows(balanceRows, period, reportType, 'balancesheet_vip');
    assertExpectedRows(cashRows, period, reportType, 'cashflow_vip');
    batch.income.push(...incomeRows);
    batch.balanceSheet.push(...balanceRows);
    batch.cashFlow.push(...cashRows);
  }
  return batch;
}

async function fetchFinancialStatementStockWindow(
  client: TushareClient,
  tsCode: TsCode,
  startDate: TradeDate,
  endDate: TradeDate,
): Promise<FinancialStatementBatch> {
  const batch: FinancialStatementBatch = { income: [], balanceSheet: [], cashFlow: [] };
  for (const reportType of FINANCIAL_REPORT_TYPES) {
    const params = {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate,
      report_type: reportType,
    };
    const [incomeRows, balanceRows, cashRows] = await Promise.all([
      incomeStatement(client, params),
      balanceSheet(client, params),
      cashFlowStatement(client, params),
    ]);
    assertExpectedRows(incomeRows, undefined, reportType, 'income');
    assertExpectedRows(balanceRows, undefined, reportType, 'balancesheet');
    assertExpectedRows(cashRows, undefined, reportType, 'cashflow');
    batch.income.push(...incomeRows);
    batch.balanceSheet.push(...balanceRows);
    batch.cashFlow.push(...cashRows);
  }
  return batch;
}

async function persistFinancialStatementBatch(
  batch: FinancialStatementBatch,
  database: FinancialStatementDatabase,
): Promise<PersistedFinancialStatementChanges> {
  const observedAt = new Date().toISOString();
  const normalized = {
    income: normalizeRows('income', batch.income, observedAt),
    balanceSheet: normalizeRows('balance_sheet', batch.balanceSheet, observedAt),
    cashFlow: normalizeRows('cash_flow', batch.cashFlow, observedAt),
  };
  const allRows = [...normalized.income, ...normalized.balanceSheet, ...normalized.cashFlow];
  if (allRows.length === 0) {
    return { created: 0, changedCodes: new Set() };
  }

  const sessions = await loadTradingSessions(allRows, database);
  const evidence = await loadCorrectionEvidence(allRows, database);
  const nextOpenDate = (date: string): string | undefined => nextStrictlyLaterDate(sessions, date);
  const incomeData = normalized.income.map((row) => ({
    ...commonStatementData(row, normalized.income, nextOpenDate, evidence),
    totalRevenue: numberValue(row.values.total_revenue, 'total_revenue'),
    revenue: numberValue(row.values.revenue, 'revenue'),
    operCost: numberValue(row.values.oper_cost, 'oper_cost'),
    operateProfit: numberValue(row.values.operate_profit, 'operate_profit'),
    totalProfit: numberValue(row.values.total_profit, 'total_profit'),
    incomeTax: numberValue(row.values.income_tax, 'income_tax'),
    nIncome: numberValue(row.values.n_income, 'n_income'),
    nIncomeAttrP: numberValue(row.values.n_income_attr_p, 'n_income_attr_p'),
    ebit: numberValue(row.values.ebit, 'ebit'),
    rdExp: numberValue(row.values.rd_exp, 'rd_exp'),
    finExpIntExp: numberValue(row.values.fin_exp_int_exp, 'fin_exp_int_exp'),
  }));
  const balanceData = normalized.balanceSheet.map((row) => ({
    ...commonStatementData(row, normalized.balanceSheet, nextOpenDate, evidence),
    moneyCap: numberValue(row.values.money_cap, 'money_cap'),
    tradAsset: numberValue(row.values.trad_asset, 'trad_asset'),
    notesReceiv: numberValue(row.values.notes_receiv, 'notes_receiv'),
    accountsReceiv: numberValue(row.values.accounts_receiv, 'accounts_receiv'),
    accountsReceivBill: numberValue(row.values.accounts_receiv_bill, 'accounts_receiv_bill'),
    othReceiv: numberValue(row.values.oth_receiv, 'oth_receiv'),
    othRcvTotal: numberValue(row.values.oth_rcv_total, 'oth_rcv_total'),
    inventories: numberValue(row.values.inventories, 'inventories'),
    prepayment: numberValue(row.values.prepayment, 'prepayment'),
    contractAssets: numberValue(row.values.contract_assets, 'contract_assets'),
    othCurAssets: numberValue(row.values.oth_cur_assets, 'oth_cur_assets'),
    totalCurAssets: numberValue(row.values.total_cur_assets, 'total_cur_assets'),
    fixAssets: numberValue(row.values.fix_assets, 'fix_assets'),
    fixAssetsTotal: numberValue(row.values.fix_assets_total, 'fix_assets_total'),
    cip: numberValue(row.values.cip, 'cip'),
    cipTotal: numberValue(row.values.cip_total, 'cip_total'),
    intanAssets: numberValue(row.values.intan_assets, 'intan_assets'),
    goodwill: numberValue(row.values.goodwill, 'goodwill'),
    deferTaxAssets: numberValue(row.values.defer_tax_assets, 'defer_tax_assets'),
    othNca: numberValue(row.values.oth_nca, 'oth_nca'),
    totalNca: numberValue(row.values.total_nca, 'total_nca'),
    totalAssets: numberValue(row.values.total_assets, 'total_assets'),
    notesPayable: numberValue(row.values.notes_payable, 'notes_payable'),
    acctPayable: numberValue(row.values.acct_payable, 'acct_payable'),
    accountsPay: numberValue(row.values.accounts_pay, 'accounts_pay'),
    advReceipts: numberValue(row.values.adv_receipts, 'adv_receipts'),
    contractLiab: numberValue(row.values.contract_liab, 'contract_liab'),
    payrollPayable: numberValue(row.values.payroll_payable, 'payroll_payable'),
    taxesPayable: numberValue(row.values.taxes_payable, 'taxes_payable'),
    othPayable: numberValue(row.values.oth_payable, 'oth_payable'),
    othPayTotal: numberValue(row.values.oth_pay_total, 'oth_pay_total'),
    stBorr: numberValue(row.values.st_borr, 'st_borr'),
    nonCurLiabDue1y: numberValue(row.values.non_cur_liab_due_1y, 'non_cur_liab_due_1y'),
    ltBorr: numberValue(row.values.lt_borr, 'lt_borr'),
    bondPayable: numberValue(row.values.bond_payable, 'bond_payable'),
    othCurLiab: numberValue(row.values.oth_cur_liab, 'oth_cur_liab'),
    totalCurLiab: numberValue(row.values.total_cur_liab, 'total_cur_liab'),
    othNcl: numberValue(row.values.oth_ncl, 'oth_ncl'),
    totalNcl: numberValue(row.values.total_ncl, 'total_ncl'),
    totalLiab: numberValue(row.values.total_liab, 'total_liab'),
    minorityInt: numberValue(row.values.minority_int, 'minority_int'),
    totalHldrEqyExcMinInt: numberValue(
      row.values.total_hldr_eqy_exc_min_int,
      'total_hldr_eqy_exc_min_int',
    ),
    totalShare: numberValue(row.values.total_share, 'total_share'),
  }));
  const cashData = normalized.cashFlow.map((row) => ({
    ...commonStatementData(row, normalized.cashFlow, nextOpenDate, evidence),
    nCashflowAct: numberValue(row.values.n_cashflow_act, 'n_cashflow_act'),
    cPayAcqConstFiolta: numberValue(row.values.c_pay_acq_const_fiolta, 'c_pay_acq_const_fiolta'),
    nCashflowInvAct: numberValue(row.values.n_cashflow_inv_act, 'n_cashflow_inv_act'),
    nCashFlowsFncAct: numberValue(row.values.n_cash_flows_fnc_act, 'n_cash_flows_fnc_act'),
    cPayDistDpcpIntExp: numberValue(row.values.c_pay_dist_dpcp_int_exp, 'c_pay_dist_dpcp_int_exp'),
    nIncrCashCashEqu: numberValue(row.values.n_incr_cash_cash_equ, 'n_incr_cash_cash_equ'),
    cCashEquBegPeriod: numberValue(row.values.c_cash_equ_beg_period, 'c_cash_equ_beg_period'),
    cCashEquEndPeriod: numberValue(row.values.c_cash_equ_end_period, 'c_cash_equ_end_period'),
    netProfit: numberValue(row.values.net_profit, 'net_profit'),
    deprFaCogaDpba: numberValue(row.values.depr_fa_coga_dpba, 'depr_fa_coga_dpba'),
    amortIntangAssets: numberValue(row.values.amort_intang_assets, 'amort_intang_assets'),
    freeCashflow: numberValue(row.values.free_cashflow, 'free_cashflow'),
  }));

  const [incomeChanges, balanceChanges, cashChanges] = await Promise.all([
    appendRows(
      incomeData,
      (fingerprints) =>
        database.financialIncomeStatement.findMany({
          where: { sourceRowFingerprint: { in: fingerprints } },
          select: { sourceRowFingerprint: true },
        }),
      (rows) => database.financialIncomeStatement.createMany({ data: rows }),
    ),
    appendRows(
      balanceData,
      (fingerprints) =>
        database.financialBalanceSheet.findMany({
          where: { sourceRowFingerprint: { in: fingerprints } },
          select: { sourceRowFingerprint: true },
        }),
      (rows) => database.financialBalanceSheet.createMany({ data: rows }),
    ),
    appendRows(
      cashData,
      (fingerprints) =>
        database.financialCashFlowStatement.findMany({
          where: { sourceRowFingerprint: { in: fingerprints } },
          select: { sourceRowFingerprint: true },
        }),
      (rows) => database.financialCashFlowStatement.createMany({ data: rows }),
    ),
  ]);
  return {
    created: incomeChanges.created + balanceChanges.created + cashChanges.created,
    changedCodes: new Set([
      ...incomeChanges.changedCodes,
      ...balanceChanges.changedCodes,
      ...cashChanges.changedCodes,
    ]),
  };
}

function normalizeRows(
  statementKind: FinancialStatementKind,
  rows: Array<IncomeStatementRow | BalanceSheetRow | CashFlowStatementRow>,
  observedAt: string,
): FinancialStatementSourceRow[] {
  const byFingerprint = new Map<string, FinancialStatementSourceRow>();
  for (const source of rows) {
    const sourceRow = normalizeFinancialStatementSourceRow(
      statementKind,
      source as unknown as TushareRow,
      observedAt,
    );
    const row = Object.freeze({
      ...sourceRow,
      tsCode: canonicalStockCode(sourceRow.tsCode),
    });
    if (isV1IndustrialConsolidatedStatement(row)) {
      byFingerprint.set(row.sourceRowFingerprint, row);
    }
  }
  return [...byFingerprint.values()];
}

function commonStatementData(
  row: FinancialStatementSourceRow,
  siblings: FinancialStatementSourceRow[],
  nextOpenDate: (date: string) => string | undefined,
  evidence: FinancialCorrectionEvidence[],
) {
  const availability = resolveFinancialAvailability(row, siblings, nextOpenDate, evidence);
  return {
    id: ulid(),
    source: row.source,
    contractVersion: FINANCIAL_SOURCE_CONTRACT_VERSION,
    tsCode: canonicalStockCode(row.tsCode),
    annDate: row.annDate,
    fAnnDate: row.fAnnDate,
    endDate: row.endDate,
    reportType: row.reportType,
    compType: row.compType,
    updateFlag: row.updateFlag,
    observedAt: new Date(row.observedAt),
    sourceRowFingerprint: row.sourceRowFingerprint,
    announcementDate: availability.announcementDate,
    availableDate: availability.availableDate,
    availabilityQuality: availability.quality,
    evidenceSource: availability.evidenceSource,
    evidenceId: availability.evidenceId ?? null,
  };
}

async function loadTradingSessions(
  rows: FinancialStatementSourceRow[],
  database: FinancialStatementDatabase,
): Promise<string[]> {
  const announcementDates = rows
    .map((row) => row.fAnnDate ?? row.annDate)
    .filter((date): date is string => date != null)
    .sort();
  const firstDate = announcementDates[0];
  const lastDate = announcementDates.at(-1);
  if (!firstDate || !lastDate) {
    throw new Error('Financial statement batch has no announcement dates');
  }

  const sessions = await database.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gt: firstDate, lte: addDays(lastDate, 31) },
    },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return sessions.map((session) => session.calDate);
}

async function loadCorrectionEvidence(
  rows: FinancialStatementSourceRow[],
  database: FinancialStatementDatabase,
): Promise<FinancialCorrectionEvidence[]> {
  const codes = [...new Set(rows.map((row) => canonicalStockCode(row.tsCode)))];
  const dates = [
    ...new Set(
      rows.map((row) => row.fAnnDate ?? row.annDate).filter((date): date is string => date != null),
    ),
  ];
  const evidenceRows = [];
  for (const codeBatch of chunks(codes, DATABASE_BATCH_SIZE)) {
    evidenceRows.push(
      ...(await database.financialCorrectionEvidence.findMany({
        where: { tsCode: { in: codeBatch }, publishedDate: { in: dates } },
      })),
    );
  }
  return evidenceRows.map((row) => ({
    source: 'cninfo',
    sourceId: row.sourceId,
    tsCode: row.tsCode,
    publishedAt: row.publishedAt.toISOString(),
    publishedDate: row.publishedDate,
    title: row.title,
    documentUrl: row.documentUrl,
    affectedPeriods: stringArray(row.affectedPeriods, 'affectedPeriods'),
    sourceFingerprint: row.sourceFingerprint,
  }));
}

async function appendRows<Row extends { sourceRowFingerprint: string; tsCode: string }>(
  rows: Row[],
  findExisting: (fingerprints: string[]) => Promise<Array<{ sourceRowFingerprint: string }>>,
  createMany: (rows: Row[]) => Promise<{ count: number }>,
): Promise<PersistedFinancialStatementChanges> {
  const existingFingerprints = new Set<string>();
  for (const rowBatch of chunks(rows, DATABASE_BATCH_SIZE)) {
    const existing = await findExisting(rowBatch.map((row) => row.sourceRowFingerprint));
    for (const row of existing) {
      existingFingerprints.add(row.sourceRowFingerprint);
    }
  }
  const missing = rows.filter((row) => !existingFingerprints.has(row.sourceRowFingerprint));
  let created = 0;
  for (const rowBatch of chunks(missing, DATABASE_BATCH_SIZE)) {
    created += (await createMany(rowBatch)).count;
  }
  return { created, changedCodes: new Set(missing.map((row) => row.tsCode)) };
}

async function attachEvidenceToUnambiguousVersion(
  findCandidates: () => Promise<Array<{ id: string }>>,
  update: (id: string) => Promise<unknown>,
): Promise<boolean> {
  const candidates = await findCandidates();
  if (candidates.length !== 1) {
    return false;
  }
  await update(candidates[0].id);
  return true;
}

function assertExpectedRows(
  rows: Array<IncomeStatementRow | BalanceSheetRow | CashFlowStatementRow>,
  period: string | undefined,
  reportType: FinancialStatementReportType,
  apiName: string,
): void {
  if (period && rows.some((row) => row.end_date !== period)) {
    throw new Error(`${apiName} returned a mismatched report period for ${period}`);
  }
  if (rows.some((row) => String(row.report_type) !== reportType)) {
    throw new Error(`${apiName} returned a mismatched report_type for ${reportType}`);
  }
}

function emptyFinancialStatementSyncSummary(requested: number): FinancialStatementSyncSummary {
  return { requested, skipped: 0, processed: 0, changed: 0, created: 0, updated: 0, deleted: 0 };
}

function nextStrictlyLaterDate(sortedDates: string[], target: string): string | undefined {
  let low = 0;
  let high = sortedDates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedDates[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return sortedDates[low];
}

function numberValue(value: TushareValue | undefined, field: string): number | null {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Financial statement field ${field} is not numeric: ${String(value)}`);
  }
  return number;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Financial correction evidence has invalid ${field}`);
  }
  return value;
}

function chunks<Row>(rows: readonly Row[], size: number): Row[][] {
  const result: Row[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function assertDate(value: string, field: string): void {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Financial statement ${field} must use YYYYMMDD`);
  }
}

function assertTsCode(value: string): void {
  if (!/^\d{6}\.(?:SH|SZ|BJ)$/.test(value)) {
    throw new Error(`Invalid A-share code: ${value}`);
  }
}
