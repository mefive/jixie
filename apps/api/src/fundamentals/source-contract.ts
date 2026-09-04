import { createHash } from 'node:crypto';

import type { TushareRow, TushareValue } from '../tushare/client.js';

export const FINANCIAL_SOURCE_CONTRACT_VERSION = 1;
export const FINANCIAL_STATEMENT_SOURCE = 'tushare' as const;

export type FinancialStatementKind = 'income' | 'balance_sheet' | 'cash_flow';
export type FinancialAvailabilityQuality = 'exact' | 'conservative' | 'reconstructed';
export type FinancialFieldUnit = 'CNY' | 'shares';
export type FinancialFieldPeriodSemantics = 'flow_ytd' | 'stock';

export interface FinancialSourceFieldDefinition {
  statementKind: FinancialStatementKind;
  sourceField: string;
  concept: string;
  unit: FinancialFieldUnit;
  periodSemantics: FinancialFieldPeriodSemantics;
  nullable: true;
}

export interface FinancialStatementSourceRow {
  source: typeof FINANCIAL_STATEMENT_SOURCE;
  statementKind: FinancialStatementKind;
  tsCode: string;
  annDate: string | null;
  fAnnDate: string | null;
  endDate: string;
  reportType: string;
  compType: string;
  updateFlag: string | null;
  observedAt: string;
  sourceRowFingerprint: string;
  values: Readonly<TushareRow>;
}

export interface FinancialAvailability {
  announcementDate: string;
  availableDate: string;
  quality: FinancialAvailabilityQuality;
  evidenceSource: 'tushare_statement' | 'cninfo_announcement';
  evidenceId?: string;
}

export interface FinancialCorrectionEvidence {
  source: 'cninfo';
  sourceId: string;
  tsCode: string;
  publishedAt: string;
  publishedDate: string;
  title: string;
  documentUrl: string;
  affectedPeriods: readonly string[];
  sourceFingerprint: string;
}

export const FINANCIAL_STATEMENT_FIELDS: readonly FinancialSourceFieldDefinition[] = [
  ...fields('income', 'flow_ytd', 'CNY', [
    ['total_revenue', 'total_revenue'],
    ['revenue', 'operating_revenue'],
    ['oper_cost', 'operating_cost'],
    ['operate_profit', 'operating_profit'],
    ['total_profit', 'total_profit'],
    ['income_tax', 'income_tax_expense'],
    ['n_income', 'net_income'],
    ['n_income_attr_p', 'net_income_attributable_to_parent'],
    ['ebit', 'ebit_source_cross_check'],
    ['rd_exp', 'research_and_development_expense'],
    ['fin_exp_int_exp', 'interest_expense'],
  ]),
  ...fields('balance_sheet', 'stock', 'CNY', [
    ['money_cap', 'cash_and_cash_equivalents'],
    ['trad_asset', 'trading_financial_assets'],
    ['notes_receiv', 'notes_receivable'],
    ['accounts_receiv', 'accounts_receivable'],
    ['accounts_receiv_bill', 'notes_and_accounts_receivable'],
    ['oth_receiv', 'other_receivables'],
    ['oth_rcv_total', 'other_receivables_total'],
    ['inventories', 'inventories'],
    ['prepayment', 'prepayments'],
    ['contract_assets', 'contract_assets'],
    ['oth_cur_assets', 'other_current_assets'],
    ['total_cur_assets', 'total_current_assets'],
    ['fix_assets', 'fixed_assets'],
    ['fix_assets_total', 'fixed_assets_total'],
    ['cip', 'construction_in_progress'],
    ['cip_total', 'construction_in_progress_total'],
    ['intan_assets', 'intangible_assets'],
    ['goodwill', 'goodwill'],
    ['defer_tax_assets', 'deferred_tax_assets'],
    ['oth_nca', 'other_non_current_assets'],
    ['total_nca', 'total_non_current_assets'],
    ['total_assets', 'total_assets'],
    ['notes_payable', 'notes_payable'],
    ['acct_payable', 'accounts_payable'],
    ['accounts_pay', 'notes_and_accounts_payable'],
    ['adv_receipts', 'advances_from_customers'],
    ['contract_liab', 'contract_liabilities'],
    ['payroll_payable', 'payroll_payable'],
    ['taxes_payable', 'taxes_payable'],
    ['oth_payable', 'other_payables'],
    ['oth_pay_total', 'other_payables_total'],
    ['st_borr', 'short_term_borrowings'],
    ['non_cur_liab_due_1y', 'current_portion_of_non_current_liabilities'],
    ['lt_borr', 'long_term_borrowings'],
    ['bond_payable', 'bonds_payable'],
    ['oth_cur_liab', 'other_current_liabilities'],
    ['total_cur_liab', 'total_current_liabilities'],
    ['oth_ncl', 'other_non_current_liabilities'],
    ['total_ncl', 'total_non_current_liabilities'],
    ['total_liab', 'total_liabilities'],
    ['minority_int', 'minority_interests'],
    ['total_hldr_eqy_exc_min_int', 'equity_attributable_to_parent'],
  ]),
  {
    statementKind: 'balance_sheet',
    sourceField: 'total_share',
    concept: 'issued_shares',
    unit: 'shares',
    periodSemantics: 'stock',
    nullable: true,
  },
  ...fields('cash_flow', 'flow_ytd', 'CNY', [
    ['n_cashflow_act', 'net_cash_flow_from_operating_activities'],
    ['c_pay_acq_const_fiolta', 'cash_paid_for_property_plant_and_intangibles'],
    ['n_cashflow_inv_act', 'net_cash_flow_from_investing_activities'],
    ['n_cash_flows_fnc_act', 'net_cash_flow_from_financing_activities'],
    ['c_pay_dist_dpcp_int_exp', 'cash_paid_for_distributions_and_interest'],
    ['n_incr_cash_cash_equ', 'net_increase_in_cash_and_cash_equivalents'],
    ['c_cash_equ_beg_period', 'cash_and_cash_equivalents_at_period_start'],
    ['c_cash_equ_end_period', 'cash_and_cash_equivalents_at_period_end'],
    ['net_profit', 'net_profit_cash_flow_reconciliation'],
    ['depr_fa_coga_dpba', 'depreciation_of_fixed_and_biological_assets'],
    ['amort_intang_assets', 'amortization_of_intangible_assets'],
    ['free_cashflow', 'vendor_free_cash_flow_cross_check'],
  ]),
] as const;

export const FINANCIAL_STATEMENT_IDENTITY_FIELDS = [
  'ts_code',
  'ann_date',
  'f_ann_date',
  'end_date',
  'report_type',
  'comp_type',
  'update_flag',
] as const;

export function financialStatementSourceFields(statementKind: FinancialStatementKind): string[] {
  return [
    ...FINANCIAL_STATEMENT_IDENTITY_FIELDS,
    ...FINANCIAL_STATEMENT_FIELDS.filter(
      (definition) => definition.statementKind === statementKind,
    ).map((definition) => definition.sourceField),
  ];
}

/** Tushare report_type 1/4/5 and comp_type=1 are consolidated industrial statement versions. */
export function isV1IndustrialConsolidatedStatement(row: FinancialStatementSourceRow): boolean {
  return ['1', '4', '5'].includes(row.reportType) && row.compType === '1';
}

export function normalizeFinancialStatementSourceRow(
  statementKind: FinancialStatementKind,
  row: TushareRow,
  observedAt = new Date().toISOString(),
): FinancialStatementSourceRow {
  const tsCode = requiredString(row, 'ts_code');
  const endDate = requiredDate(row, 'end_date');
  const reportType = requiredString(row, 'report_type');
  const compType = requiredString(row, 'comp_type');
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error(`Financial statement source row has invalid observedAt: ${observedAt}`);
  }
  const values = Object.freeze({ ...row });
  return Object.freeze({
    source: FINANCIAL_STATEMENT_SOURCE,
    statementKind,
    tsCode,
    annDate: nullableDate(row, 'ann_date'),
    fAnnDate: nullableDate(row, 'f_ann_date'),
    endDate,
    reportType,
    compType,
    updateFlag: nullableString(row, 'update_flag'),
    observedAt,
    sourceRowFingerprint: financialSourceRowFingerprint(statementKind, values),
    values,
  });
}

/** Fingerprints the complete selected source row; object key order and undefined fields do not matter. */
export function financialSourceRowFingerprint(
  statementKind: FinancialStatementKind,
  row: Readonly<TushareRow>,
): string {
  const canonical = Object.entries(row)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(JSON.stringify([FINANCIAL_SOURCE_CONTRACT_VERSION, statementKind, canonical]))
    .digest('hex');
}

export function financialStatementAnnouncementIdentity(row: FinancialStatementSourceRow): string {
  return [
    row.source,
    row.tsCode,
    row.statementKind,
    row.endDate,
    row.annDate ?? '',
    row.fAnnDate ?? '',
    row.reportType,
    row.compType,
  ].join('|');
}

export function financialStatementPeriodIdentity(row: FinancialStatementSourceRow): string {
  return [
    row.source,
    row.tsCode,
    row.statementKind,
    row.endDate,
    row.reportType,
    row.compType,
  ].join('|');
}

/** Values-only identity excludes source metadata so dated statement revisions can be compared. */
export function financialStatementValuesFingerprint(row: FinancialStatementSourceRow): string {
  const metadata = new Set([
    'ts_code',
    'ann_date',
    'f_ann_date',
    'end_date',
    'report_type',
    'comp_type',
    'end_type',
    'update_flag',
  ]);
  return financialSourceRowFingerprint(
    row.statementKind,
    Object.fromEntries(Object.entries(row.values).filter(([field]) => !metadata.has(field))),
  );
}

/**
 * Append-only merge used by fixtures and ingestion. Exact duplicates are ignored, while a changed
 * source row for the same announcement remains a separate version.
 */
export function appendFinancialStatementSourceRows(
  existing: readonly FinancialStatementSourceRow[],
  incoming: readonly FinancialStatementSourceRow[],
): FinancialStatementSourceRow[] {
  const byFingerprint = new Map(existing.map((row) => [row.sourceRowFingerprint, row] as const));
  for (const row of incoming) {
    if (!byFingerprint.has(row.sourceRowFingerprint)) {
      byFingerprint.set(row.sourceRowFingerprint, row);
    }
  }
  return [...byFingerprint.values()];
}

/**
 * V1 delays every dated release until the next session. CNInfo evidence can prove a correction
 * date; a same-date Tushare content change without such evidence remains reconstructed.
 */
export function resolveFinancialAvailability(
  row: FinancialStatementSourceRow,
  siblings: readonly FinancialStatementSourceRow[],
  nextOpenDate: (date: string) => string | undefined,
  correctionEvidence: readonly FinancialCorrectionEvidence[] = [],
): FinancialAvailability {
  const announcementDate = row.fAnnDate ?? row.annDate;
  if (!announcementDate) {
    throw new Error('Financial statement row has no actual or announcement date');
  }
  const availableDate = nextOpenDate(announcementDate);
  if (!availableDate || availableDate <= announcementDate) {
    throw new Error(`No strictly later trading session is available after ${announcementDate}`);
  }
  const matchingEvidence = correctionEvidence.find(
    (evidence) =>
      evidence.tsCode === row.tsCode &&
      evidence.publishedDate === announcementDate &&
      evidence.affectedPeriods.includes(row.endDate),
  );
  const sameAnnouncement = siblings.filter(
    (candidate) =>
      financialStatementAnnouncementIdentity(candidate) ===
      financialStatementAnnouncementIdentity(row),
  );
  const materialVariants = new Set(sameAnnouncement.map(financialStatementValuesFingerprint)).size;
  // An announcement proves timing, but cannot disambiguate several provider value variants dated
  // to that same announcement. Keep those variants conservative/reconstructed until reconciled.
  const exactEvidence = materialVariants <= 1 ? matchingEvidence : undefined;
  const unresolvedProviderChange = !exactEvidence && materialVariants > 1 && row.updateFlag !== '0';
  return {
    announcementDate,
    availableDate,
    quality: exactEvidence ? 'exact' : unresolvedProviderChange ? 'reconstructed' : 'conservative',
    evidenceSource: exactEvidence ? 'cninfo_announcement' : 'tushare_statement',
    ...(exactEvidence ? { evidenceId: exactEvidence.sourceId } : {}),
  };
}

function fields(
  statementKind: FinancialStatementKind,
  periodSemantics: FinancialFieldPeriodSemantics,
  unit: FinancialFieldUnit,
  definitions: ReadonlyArray<readonly [sourceField: string, concept: string]>,
): FinancialSourceFieldDefinition[] {
  return definitions.map(([sourceField, concept]) => ({
    statementKind,
    sourceField,
    concept,
    unit,
    periodSemantics,
    nullable: true,
  }));
}

function requiredString(row: TushareRow, field: string): string {
  const value = stringValue(row[field]);
  if (!value) {
    throw new Error(`Financial statement source row omitted ${field}`);
  }
  return value;
}

function requiredDate(row: TushareRow, field: string): string {
  const value = requiredString(row, field);
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Financial statement source row has invalid ${field}: ${value}`);
  }
  return value;
}

function nullableString(row: TushareRow, field: string): string | null {
  return stringValue(row[field]) || null;
}

function nullableDate(row: TushareRow, field: string): string | null {
  const value = nullableString(row, field);
  if (value && !/^\d{8}$/.test(value)) {
    throw new Error(`Financial statement source row has invalid ${field}: ${value}`);
  }
  return value;
}

function stringValue(value: TushareValue | undefined): string {
  return value == null ? '' : String(value).trim();
}
