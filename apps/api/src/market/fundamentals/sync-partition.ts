import { nextVerifiedSession } from '../calendar/coverage.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { calendarDay, isObservationDate, localDate } from '../synchronization/date.js';
import { fingerprint } from '../synchronization/rows.js';
import type {
  MarketPartition,
  MarketRow,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  type SyncSource,
} from '../synchronization/source.js';
import {
  FINANCIAL_SOURCE_CONTRACT_VERSION,
  FINANCIAL_STORAGE_COLUMNS,
  FINANCIAL_STATEMENT_FIELDS,
  financialStatementSourceFields,
  normalizeFinancialStatementSourceRow,
  resolveFinancialAvailability,
  type FinancialStatementKind,
  type FinancialCorrectionEvidence,
  type FinancialStatementSourceRow,
} from './source-contract.js';

/**
 * 保留来源版本而非只覆盖报告期最新值；单个完整报表是接纳单位。
 *
 * Retain source versions rather than only the latest period; a complete statement is the admission
 * unit.
 */
export async function prepareFinancialPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  switch (partition.dataset) {
    case 'financial-statements':
      return prepareStatementPartition(source, partition, fetchedAt);
    case 'dividends':
      return prepareDividendPartition(source, partition);
    case 'financial-indicators':
      return prepareIndicatorPartition(source, partition, fetchedAt);
    default:
      throw new Error(`Unknown financial dataset ${partition.dataset}`);
  }
}

async function prepareStatementPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const [kind, reportType] = partition.scope.split('|');
  if (
    !['income', 'balance_sheet', 'cash_flow'].includes(kind) ||
    !['1', '4', '5'].includes(reportType)
  ) {
    throw new Error('Invalid financial statement partition');
  }
  const statementKind = kind as FinancialStatementKind;
  const api = {
    income: 'income_vip',
    balance_sheet: 'balancesheet_vip',
    cash_flow: 'cashflow_vip',
  }[statementKind];
  const table = {
    income: 'FinancialIncomeStatement',
    balance_sheet: 'FinancialBalanceSheet',
    cash_flow: 'FinancialCashFlowStatement',
  }[statementKind];
  const pages = await fetchSourcePages(
    source,
    api,
    { period: partition.startDate, report_type: reportType },
    financialStatementSourceFields(statementKind).join(','),
    5000,
  );
  if (
    pages.rows.some(
      (row) =>
        typeof row.comp_type !== 'string' ||
        !['1', '2', '3', '4', '7'].includes(row.comp_type) ||
        row.end_date !== partition.startDate ||
        row.report_type !== reportType,
    )
  ) {
    pages.errors.push('Invalid financial report period/type/company classification');
  }

  const identity: StatementPartitionIdentity = {
    statementKind,
    table,
    api,
    reportType,
    period: partition.startDate,
    fetchedAt,
  };
  const context = await loadStatementContext(identity, pages.rows);
  const mapped = mapSourceRecords(
    pages.rows.filter((row) => row.comp_type === '1'),
    (sourceRow) => mapStatementVersion(identity, context, sourceRow),
  );

  const result = completeResponse({
    pages,
    table,
    coverageComplete: true,
    ...mapped,
    allowEmpty: true,
    observedDates: mapped.records.length ? [partition.startDate] : [],
  });
  if (
    mapped.records.some(
      (record) =>
        !context.dates.some((entry) => entry.calDate > String(record.values.announcementDate)),
    )
  ) {
    result.status = result.errors.length ? 'error' : 'partial';
    result.gaps.push('Statement values retained; availability calendar is incomplete');
  }

  return result;
}

async function prepareDividendPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  const columns = {
    tsCode: 'ts_code',
    endDate: 'end_date',
    annDate: 'ann_date',
    exDate: 'ex_date',
    divProc: 'div_proc',
    cashDiv: 'cash_div',
    cashDivTax: 'cash_div_tax',
  };
  const pages = await fetchSourcePages(
    source,
    'dividend',
    { ts_code: partition.scope },
    Object.values(columns).join(','),
  );
  if (
    pages.rows.some(
      (row) =>
        typeof row.end_date !== 'string' ||
        !isObservationDate(row.end_date) ||
        canonicalStockCode(String(row.ts_code)) !== partition.scope,
    )
  ) {
    pages.errors.push('Invalid dividend identity/report period');
  }
  const mapped = mapSourceRecords(
    pages.rows.filter(
      (row) =>
        typeof row.end_date === 'string' &&
        row.end_date >= partition.startDate &&
        row.end_date <= partition.endDate,
    ),
    (row) => {
      if (canonicalStockCode(sourceString(row, 'ts_code')) !== partition.scope) {
        throw new Error('Unexpected dividend security');
      }
      const values = { ...sourceValues(row, columns), tsCode: partition.scope };
      const id = fingerprint({
        tsCode: partition.scope,
        endDate: row.end_date,
        annDate: row.ann_date,
        exDate: row.ex_date,
        divProc: row.div_proc,
      });

      return {
        values: { ...values, id },
      };
    },
  );

  return completeResponse({
    pages,
    table: 'Dividend',
    coverageComplete: true,
    replace: true,
    ...mapped,
    allowEmpty: true,
    observedDates: mapped.records.map((record) => String(record.values.endDate)),
  });
}

async function prepareIndicatorPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const columns = {
    tsCode: 'ts_code',
    endDate: 'end_date',
    annDate: 'ann_date',
    roe: 'roe',
    roeWaa: 'roe_waa',
    roa: 'roa',
    grossprofitMargin: 'grossprofit_margin',
    netprofitMargin: 'netprofit_margin',
    debtToAssets: 'debt_to_assets',
    orYoy: 'or_yoy',
    netprofitYoy: 'netprofit_yoy',
    ocfToProfit: 'ocf_to_profit',
  };
  const pages = await fetchSourcePages(
    source,
    'fina_indicator_vip',
    { period: partition.startDate },
    `${Object.values(columns).join(',')},update_flag`,
    10000,
  );
  const captureDate = localDate(fetchedAt);
  const nextSession = await nextVerifiedSession(captureDate);
  const updateFlags = new Map<string, string>();
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (row.end_date !== partition.startDate) {
      throw new Error('Unexpected financial indicator period');
    }
    const values = {
      ...sourceValues(row, columns),
      tsCode: canonicalStockCode(sourceString(row, 'ts_code')),
    };
    const businessFingerprint = fingerprint(values);
    updateFlags.set(
      businessFingerprint,
      row.update_flag === '1' ? '1' : (updateFlags.get(businessFingerprint) ?? '0'),
    );
    const firstKnownDate = nextSession ?? calendarDay(captureDate, 1);
    const quality = nextSession ? 'latest_only' : 'unknown';
    const version: SourceRecord = {
      values: {
        ...values,
        id: ulid(),
        availableDate: firstKnownDate,
        availabilityQuality: quality,
        observedAt: fetchedAt,
        sourceFingerprint: businessFingerprint,
      },
    };

    return version;
  });
  const snapshots = new Map<string, SourceRecord>();
  const conflicts = new Set<string>();
  const priorities = new Map<string, string>();
  for (const record of mapped.records) {
    const code = String(record.values.tsCode);
    const announcementDate = record.values.annDate ?? '';
    const updateFlag = updateFlags.get(String(record.values.sourceFingerprint)) ?? '0';
    const priority = `${announcementDate}|${updateFlag}`;
    const previous = snapshots.get(code);
    if (previous && priority < priorities.get(code)!) {
      continue;
    }
    const {
      id: _id,
      availableDate: _available,
      availabilityQuality: _quality,
      observedAt: _observed,
      sourceFingerprint: _fingerprint,
      ...values
    } = record.values;
    if (
      previous &&
      priority === priorities.get(code) &&
      fingerprint(previous.values) !== fingerprint(values)
    ) {
      conflicts.add(code);
      continue;
    }
    if (!previous || priority > priorities.get(code)!) {
      conflicts.delete(code);
    }
    snapshots.set(code, { values, authoritativeRevision: priority.endsWith('|1') });
    priorities.set(code, priority);
  }
  for (const code of conflicts) {
    snapshots.delete(code);
    mapped.errors.push(`Ambiguous current indicator version ${code}/${partition.startDate}`);
  }
  const result = completeResponse({
    pages,
    table: 'FinaIndicatorVersion',
    coverageComplete: true,
    ...mapped,
    allowEmpty: true,
    observedDates: mapped.records.length ? [partition.startDate] : [],
  });
  result.tables.push({ table: 'FinaIndicator', records: [...snapshots.values()] });
  if (!nextSession && mapped.records.length) {
    result.status = result.errors.length ? 'error' : 'partial';
    result.gaps.push(
      'Indicator versions retained with unknown availability until the capture calendar is verified',
    );
  }

  return result;
}

interface StatementPartitionIdentity {
  statementKind: FinancialStatementKind;
  table: string;
  api: string;
  reportType: string;
  period: string;
  fetchedAt: Date;
}

async function loadStatementContext(identity: StatementPartitionIdentity, rows: TushareRow[]) {
  const { statementKind, reportType, period, fetchedAt } = identity;
  const dates = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1 },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const siblings: FinancialStatementSourceRow[] = [];
  const database = getDatabase();
  const where = { endDate: period, reportType };
  const existing = await loadStoredStatements(database, statementKind, where);
  const fields = FINANCIAL_STATEMENT_FIELDS.filter(
    (field) => field.statementKind === statementKind,
  );
  for (const stored of existing) {
    const sourceRow = Object.fromEntries(
      [
        ['ts_code', stored.tsCode],
        ['ann_date', stored.annDate],
        ['f_ann_date', stored.fAnnDate],
        ['end_date', stored.endDate],
        ['report_type', stored.reportType],
        ['comp_type', stored.compType],
        ['update_flag', stored.updateFlag],
        ...fields.map((field) => [
          field.sourceField,
          (stored as Record<string, unknown>)[FINANCIAL_STORAGE_COLUMNS[field.sourceField]],
        ]),
      ].map(([field, value]) => [
        field,
        typeof value === 'string' || typeof value === 'number' ? value : null,
      ]),
    );
    siblings.push(
      normalizeFinancialStatementSourceRow(statementKind, sourceRow, fetchedAt.toISOString()),
    );
  }
  for (const sourceRow of rows.filter((row) => row.comp_type === '1')) {
    try {
      siblings.push(
        normalizeFinancialStatementSourceRow(statementKind, sourceRow, fetchedAt.toISOString()),
      );
    } catch {
      // 坏行仍由下面的逐项映射报告，不阻止其他报表。
      // The per-item mapper below reports invalid rows without blocking other statements.
    }
  }
  const corrections: FinancialCorrectionEvidence[] = [];
  const storedEvidence = await database.financialCorrectionEvidence.findMany({
    where: {
      publishedDate: {
        in: [
          ...new Set(
            siblings
              .map((row) => row.fAnnDate ?? row.annDate)
              .filter((date): date is string => date != null),
          ),
        ],
      },
    },
  });
  for (const entry of storedEvidence) {
    if (
      !Array.isArray(entry.affectedPeriods) ||
      entry.affectedPeriods.some((value) => typeof value !== 'string')
    ) {
      throw new Error('Invalid stored correction periods');
    }
    corrections.push({
      ...entry,
      source: 'cninfo',
      publishedAt: entry.publishedAt.toISOString(),
      affectedPeriods: entry.affectedPeriods as string[],
    });
  }

  return { dates, siblings, fields, corrections };
}

function mapStatementVersion(
  identity: StatementPartitionIdentity,
  context: Awaited<ReturnType<typeof loadStatementContext>>,
  sourceRow: TushareRow,
): SourceRecord {
  const { statementKind, reportType, period, fetchedAt, api } = identity;
  const { dates, siblings, fields } = context;
  const row = normalizeFinancialStatementSourceRow(
    statementKind,
    sourceRow,
    fetchedAt.toISOString(),
  );
  if (row.endDate !== period || row.reportType !== reportType) {
    throw new Error('Unexpected financial report period/type');
  }
  if (fields.some((field) => !Object.hasOwn(sourceRow, field.sourceField))) {
    throw new Error(`Incomplete financial version ${row.tsCode}/${row.endDate}`);
  }
  const announcementDate = row.fAnnDate ?? row.annDate;
  if (!announcementDate) {
    throw new Error('Financial version lacks its source announcement identity');
  }
  const nextOpenDate = dates.find((entry) => entry.calDate > announcementDate)?.calDate;
  const availability = nextOpenDate
    ? resolveFinancialAvailability(
        row,
        siblings,
        (date) => dates.find((entry) => entry.calDate > date)?.calDate,
        context.corrections,
      )
    : {
        announcementDate,
        availableDate: calendarDay(announcementDate, 1),
        quality: 'reconstructed' as const,
        evidenceSource: 'tushare_statement' as const,
      };
  const values: MarketRow = {
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
    observedAt: fetchedAt,
    sourceRowFingerprint: row.sourceRowFingerprint,
    announcementDate: availability.announcementDate,
    availableDate: availability.availableDate,
    availabilityQuality: availability.quality,
    evidenceSource: availability.evidenceSource,
    evidenceId: availability.evidenceId ?? null,
  };
  for (const field of fields) {
    const value = sourceRow[field.sourceField];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`Invalid ${api}.${field.sourceField}`);
    }
    values[FINANCIAL_STORAGE_COLUMNS[field.sourceField]] = value;
  }

  return {
    values,
  };
}

/**
 * 报表类型对应显式 Prisma 查询。
 *
 * Use an explicit Prisma query for each statement kind.
 */
async function loadStoredStatements(
  database: ReturnType<typeof getDatabase>,
  kind: FinancialStatementKind,
  where: { endDate: string; reportType: string },
) {
  switch (kind) {
    case 'income':
      return database.financialIncomeStatement.findMany({ where });
    case 'balance_sheet':
      return database.financialBalanceSheet.findMany({ where });
    case 'cash_flow':
      return database.financialCashFlowStatement.findMany({ where });
  }
}
