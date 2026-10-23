import type { TushareRow } from '../providers/tushare/tushare-client.js';
import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { calendarDay, localDate } from '../synchronization/date.js';
import { fingerprint, readMarketRows } from '../synchronization/records.js';
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
  FINANCIAL_STATEMENT_FIELDS,
  financialStatementSourceFields,
  normalizeFinancialStatementSourceRow,
  resolveFinancialAvailability,
  type FinancialStatementKind,
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
    extent: { basis: 'Validated complete statement objects in the requested period' },
    ...mapped,
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
    { ts_code: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(columns).join(','),
  );
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
        publicationDate: typeof row.ann_date === 'string' ? row.ann_date : null,
        availabilityQuality: 'latest_only',
      };
    },
  );

  return completeResponse({
    pages,
    table: 'Dividend',
    extent: {
      basis: 'Filtered dividend event contract',
      deletion: 'Complete dated dividend event extent',
    },
    ...mapped,
    allowEmpty: true,
    observedDates: mapped.records.map((record) => String(record.values.endDate)),
    where: {
      tsCode: partition.scope,
      endDate: { gte: partition.startDate, lte: partition.endDate },
    },
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
  const nextSession = await getDatabase().tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: captureDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (row.end_date !== partition.startDate) {
      throw new Error('Unexpected financial indicator period');
    }
    const values = {
      ...sourceValues(row, columns),
      tsCode: canonicalStockCode(sourceString(row, 'ts_code')),
    };
    const firstKnownDate = nextSession?.calDate ?? calendarDay(captureDate, 1);
    const quality = nextSession ? 'latest_only' : 'unknown';
    const version: SourceRecord = {
      values: {
        ...values,
        id: ulid(),
        availableDate: firstKnownDate,
        availabilityQuality: quality,
        observedAt: fetchedAt,
        sourceFingerprint: fingerprint(values),
      },
      publicationDate: typeof row.ann_date === 'string' ? row.ann_date : null,
      availableDate: firstKnownDate,
      availabilityQuality: quality,
    };

    return version;
  });
  const snapshots = new Map<string, SourceRecord>();
  for (const record of mapped.records) {
    const previous = snapshots.get(String(record.values.tsCode));
    if (!previous || String(record.values.annDate ?? '') > String(previous.values.annDate ?? '')) {
      const {
        id: _id,
        availableDate: _available,
        availabilityQuality: _quality,
        observedAt: _observed,
        sourceFingerprint: _fingerprint,
        ...values
      } = record.values;
      snapshots.set(String(record.values.tsCode), { ...record, values });
    }
  }
  const result = completeResponse({
    pages,
    table: 'FinaIndicatorVersion',
    extent: { basis: 'Latest-only indicators for the requested report period' },
    ...mapped,
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
  const { statementKind, table, reportType, period, fetchedAt } = identity;
  const dates = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1 },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const siblings: FinancialStatementSourceRow[] = [];
  const existing = await readMarketRows(getDatabase(), table, {
    endDate: period,
    reportType,
  });
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
          stored[
            field.sourceField.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
          ],
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
  return { dates, siblings, fields };
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
    values[field.sourceField.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] =
      value;
  }

  return {
    values,
    publicationDate: availability.announcementDate,
    availableDate: availability.availableDate,
    availabilityQuality: 'source_contract',
  };
}
