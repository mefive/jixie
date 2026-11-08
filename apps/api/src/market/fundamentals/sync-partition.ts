import { recordImportIssue } from '../synchronization/diagnostics.js';
import { preferLatestDividendBases } from './dividend-selection.js';
import {
  DIVIDEND_DATE_FIELDS,
  DIVIDEND_SOURCE_COLUMNS,
  DIVIDEND_SOURCE_FIELDS,
  dividendDistributionKind,
  dividendIdentityResolver,
} from './dividend-identity.js';
import { financialStockCodes } from './scope.js';
import {
  FINANCIAL_ANNOUNCEMENT_FIELDS,
  FINANCIAL_REPORT_TYPES,
  FINANCIAL_STATEMENT_APIS,
  splitStatementAnnouncementWindow,
} from './statement-requests.js';
import { preferStockSources } from '../instruments/source-selection.js';
import { nextVerifiedSession } from '../calendar/coverage.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import { ulid } from 'ulid';
import { getDatabase } from '#infra/database/prisma.js';
import {
  canonicalStockCode,
  hasStockCodePredecessor,
  stockSourceCodes,
} from '../instruments/stock-identity.js';
import { calendarDay, isObservationDate, localDate } from '../synchronization/date.js';
import { fingerprint } from '../synchronization/rows.js';
import {
  MarketSourceRangeLimitError,
  MarketSourceStorageError,
  MarketSyncBudgetError,
  TushareError,
} from '../errors.js';
import {
  finaIndicatorSchema,
  finaIndicatorVersionSchema,
  selectIndicatorSnapshots,
} from './indicator-selection.js';
import type {
  MarketPartition,
  MarketRow,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourceFirstPage,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  type SyncSource,
  type SourcePages,
} from '../synchronization/source.js';
import {
  FINANCIAL_SOURCE_CONTRACT_VERSION,
  FINANCIAL_STORAGE_COLUMNS,
  FINANCIAL_STATEMENT_FIELDS,
  financialStatementSourceFields,
  normalizeFinancialStatementSourceRow,
  latestFinancialAnnouncementDate,
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
  const [kind, reportType, historyCode] = partition.scope.split('|');
  const announcementField = partition.announcementField;
  const announcementRange = partition.announcementRange;
  if (
    !['income', 'balance_sheet', 'cash_flow'].includes(kind) ||
    !FINANCIAL_REPORT_TYPES.some((value) => value === reportType) ||
    (announcementRange &&
      (historyCode ||
        announcementField !== 'ann_date' ||
        !isObservationDate(partition.startDate) ||
        !isObservationDate(partition.endDate) ||
        partition.startDate > partition.endDate)) ||
    (announcementField &&
      (historyCode ||
        !FINANCIAL_ANNOUNCEMENT_FIELDS.includes(announcementField) ||
        (!announcementRange && partition.startDate !== partition.endDate)))
  ) {
    throw new Error('Invalid financial statement partition');
  }
  const statementKind = kind as FinancialStatementKind;
  const api = FINANCIAL_STATEMENT_APIS[statementKind];
  const table = {
    income: 'FinancialIncomeStatement',
    balance_sheet: 'FinancialBalanceSheet',
    cash_flow: 'FinancialCashFlowStatement',
  }[statementKind];
  const pages = await downloadFinancialPartition(source, partition);
  const codes = partition.catalogThrough
    ? await financialStockCodes(partition.catalogThrough)
    : undefined;
  const scopedRows = pages.rows.filter(
    (row) => !codes || codes.has(canonicalStockCode(String(row.ts_code))),
  );
  const rejected = scopedRows.filter(
    (row) =>
      typeof row.comp_type !== 'string' ||
      !['1', '2', '3', '4', '7'].includes(row.comp_type) ||
      !isObservationDate(row.end_date) ||
      (!historyCode && !announcementField && row.end_date !== partition.startDate) ||
      (announcementRange && !isObservationDate(row.ann_date)) ||
      (announcementField && !announcementRange && row[announcementField] !== partition.startDate) ||
      (historyCode && canonicalStockCode(String(row.ts_code)) !== historyCode) ||
      row.report_type !== reportType,
  );
  for (const row of rejected) {
    recordImportIssue({
      category: 'record',
      reasonCode: 'invalid_report_identity',
      message: 'Invalid financial report period/type/company classification',
      payload: row,
    });
  }

  const mapped: { records: SourceRecord[]; errors: string[] } = { records: [], errors: [] };
  let calendarIncomplete = false;
  const candidates = scopedRows.filter(
    (row) =>
      row.comp_type === '1' &&
      !rejected.includes(row) &&
      String(row.end_date) >= '19880101' &&
      String(row.end_date) <= (partition.catalogThrough ?? partition.endDate),
  );
  const periods = [...new Set(candidates.map((row) => String(row.end_date)))];
  for (const period of periods) {
    const rows = candidates.filter((row) => row.end_date === period);
    const identity: StatementPartitionIdentity = {
      statementKind,
      table,
      api,
      reportType,
      period,
      fetchedAt,
      tsCode: historyCode,
    };
    const context = await loadStatementContext(identity, rows);
    const accepted = mapSourceRecords(rows, (row) => mapStatementVersion(identity, context, row));
    mapped.records.push(...accepted.records);
    mapped.errors.push(...accepted.errors);
    calendarIncomplete ||= accepted.records.some(
      (record) =>
        !context.dates.some((entry) => entry.calDate > String(record.values.announcementDate)),
    );
  }

  mapped.errors.push(
    ...rejected.map(() => 'Invalid financial report period/type/company classification'),
  );

  const result = completeResponse({
    pages,
    table,
    ...mapped,
    allowEmpty: true,
    observedDates: [...new Set(mapped.records.map((record) => String(record.values.endDate)))],
  });
  result.hasDeferredRecords = Boolean(
    (announcementField || historyCode) &&
    scopedRows.some(
      (row) =>
        row.comp_type === '1' &&
        !rejected.includes(row) &&
        String(row.end_date) > (partition.catalogThrough ?? partition.endDate),
    ),
  );
  if (calendarIncomplete) {
    result.status = result.errors.length ? 'error' : 'partial';
    result.gaps.push('Statement values retained; availability calendar is incomplete');
  }

  return result;
}

/**
 * 区间满页时用无重叠子区间重取；偏移分页在来源上实测可能遗漏版本。
 *
 * Replace saturated windows with disjoint child queries because provider offset paging can omit versions.
 */
async function fetchStatementAnnouncementRange(
  source: SyncSource,
  api: string,
  partition: MarketPartition,
  fields: string,
  reportType: string,
): Promise<SourcePages> {
  const pageSize = 5000;
  const result: SourcePages = { rows: [], complete: false, pages: 0, errors: [] };
  const fetchWindow = async (startDate: string, endDate: string): Promise<void> => {
    const rows = await fetchSourceFirstPage(
      source,
      api,
      { start_date: startDate, end_date: endDate, report_type: reportType },
      fields,
      pageSize,
    );
    result.pages++;
    if (
      rows.some(
        ({ ann_date }) =>
          isObservationDate(ann_date) && (ann_date < startDate || ann_date > endDate),
      )
    ) {
      throw new Error(`${api}: returned a disclosure outside ${startDate}–${endDate}`);
    }
    if (rows.length < pageSize) {
      result.rows.push(...rows);
      return;
    }
    if (partition.adaptiveRange && startDate < endDate) {
      throw new MarketSourceRangeLimitError(rows.length);
    }
    if (startDate === endDate) {
      throw new Error(`${api}: disclosure date ${startDate} reached the single-page limit`);
    }

    const { leftEnd, rightStart } = splitStatementAnnouncementWindow(startDate, endDate);
    await fetchWindow(startDate, leftEnd);
    await fetchWindow(rightStart, endDate);
  };
  try {
    await fetchWindow(partition.startDate, partition.endDate);
    result.complete = true;
  } catch (error) {
    if (error instanceof MarketSourceStorageError) {
      throw error;
    }
    if (error instanceof MarketSourceRangeLimitError) {
      throw error;
    }
    if (error instanceof MarketSyncBudgetError) {
      result.deferred = true;
      return result;
    }

    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    recordImportIssue({
      category: 'request',
      reasonCode: error instanceof TushareError ? 'source_rejected_request' : 'incomplete_response',
      message,
    });
  }

  return result;
}

async function prepareDividendPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  const dateField = DIVIDEND_DATE_FIELDS.find((field) => field === partition.scope);
  const reportThrough = dateField
    ? (partition.catalogThrough ?? partition.endDate)
    : partition.endDate;
  const codes = dateField
    ? await financialStockCodes(partition.catalogThrough ?? partition.endDate)
    : null;
  const valuesOf = (row: TushareRow): MarketRow => {
    const values = {
      ...sourceValues(row, DIVIDEND_SOURCE_COLUMNS),
      tsCode: canonicalStockCode(sourceString(row, 'ts_code')),
      sourceTsCode: sourceString(row, 'ts_code'),
    };

    return { ...values, distributionKind: dividendDistributionKind(values) };
  };
  const pages = await downloadFinancialPartition(source, partition);
  const nonImplementedStages = new Set(['预披露', '预案', '股东大会通过', '未通过', '停止实施']);
  const rejected = new Set<TushareRow>();

  for (const row of pages.rows) {
    // 已知非实施阶段先退出范围，不校验或匹配其业务字段；未知阶段仍保留诊断。
    // Exclude known non-implementation stages before validation or matching; diagnose unknown stages.
    if (nonImplementedStages.has(String(row.div_proc))) {
      continue;
    }

    if (
      row.div_proc !== '实施' ||
      typeof row.ts_code !== 'string' ||
      !row.ts_code ||
      (!dateField && canonicalStockCode(row.ts_code) !== partition.scope) ||
      (dateField && row[dateField] !== partition.startDate) ||
      !isObservationDate(row.end_date)
    ) {
      rejected.add(row);
      recordImportIssue({
        category: 'record',
        reasonCode: 'invalid_dividend_identity',
        message: 'Invalid dividend stage, security, report period or announcement date',
        payload: row,
      });
    }
  }

  const scoped = pages.rows.filter(
    (row) =>
      row.div_proc === '实施' &&
      !rejected.has(row) &&
      (!codes || codes.has(canonicalStockCode(String(row.ts_code)))),
  );
  const selected = preferStockSources(
    scoped.filter((row) => String(row.end_date) <= reportThrough),
    (row) =>
      JSON.stringify([
        canonicalStockCode(String(row.ts_code)),
        row.end_date,
        row.ann_date,
        row.ex_date,
        row.div_proc,
        dividendDistributionKind(valuesOf(row)),
      ]),
    (row) => String(row.ts_code),
  );
  const affectedCodes = [
    ...new Set(selected.map((row) => canonicalStockCode(String(row.ts_code)))),
  ];
  const reportPeriods = [...new Set(selected.map((row) => String(row.end_date)))];
  const existing = await getDatabase().dividend.findMany({
    where: {
      tsCode: { in: affectedCodes },
      endDate: { in: reportPeriods },
      divProc: '实施',
    },
  });
  const resolveIdentity = dividendIdentityResolver(existing, selected.map(valuesOf));
  const mapped = mapSourceRecords(selected, (row) => {
    for (const field of ['base_date', 'record_date', 'pay_date', 'imp_ann_date', 'div_listdate']) {
      if (row[field] != null && !isObservationDate(row[field])) {
        throw new Error(`Invalid dividend date ${field}`);
      }
    }
    for (const field of ['stk_div', 'stk_bo_rate', 'stk_co_rate']) {
      const value = row[field];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid dividend share ratio ${field}`);
      }
    }

    return { values: resolveIdentity(valuesOf(row)) };
  });

  mapped.errors.push(...Array.from(rejected, () => 'Invalid dividend identity/report period'));

  const result = completeResponse({
    pages,
    table: 'Dividend',
    replace: !dateField,
    ...mapped,
    records: preferLatestDividendBases(mapped.records),
    allowEmpty: true,
    observedDates: mapped.records.map((record) => String(record.values.endDate)),
  });
  result.hasDeferredRecords = scoped.some(
    (row) =>
      String(row.end_date) > reportThrough &&
      (dateField ||
        DIVIDEND_DATE_FIELDS.some((field) => {
          const announcement = row[field];
          return isObservationDate(announcement) && announcement <= reportThrough;
        })),
  );

  return result;
}

async function prepareIndicatorPartition(
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const columns = INDICATOR_COLUMNS;
  const historyCode = partition.fullHistory ? partition.scope : undefined;
  const pages = await downloadFinancialPartition(source, partition);
  const codes = partition.catalogThrough
    ? await financialStockCodes(partition.catalogThrough)
    : undefined;
  const captureDate = localDate(fetchedAt);
  const nextSession = await nextVerifiedSession(captureDate);
  const mapped = mapSourceRecords(
    pages.rows.filter(
      (row) =>
        (!codes || codes.has(canonicalStockCode(String(row.ts_code)))) &&
        (!isObservationDate(row.end_date) || row.end_date <= partition.endDate),
    ),
    (row) => {
      if (
        !isObservationDate(row.end_date) ||
        (!historyCode && row.end_date !== partition.startDate) ||
        (historyCode && canonicalStockCode(String(row.ts_code)) !== historyCode)
      ) {
        throw new Error('Unexpected financial indicator period');
      }
      const sourceTsCode = sourceString(row, 'ts_code');
      const values = finaIndicatorSchema.parse({
        ...sourceValues(row, columns),
        tsCode: canonicalStockCode(sourceTsCode),
        sourceTsCode,
      });
      const updateFlag = row.update_flag ?? null;
      const businessFingerprint = fingerprint({ ...values, updateFlag });
      const firstKnownDate = nextSession ?? calendarDay(captureDate, 1);
      const quality = nextSession ? 'latest_only' : 'unknown';
      const version: SourceRecord = {
        values: finaIndicatorVersionSchema.parse({
          ...values,
          updateFlag,
          id: ulid(),
          availableDate: firstKnownDate,
          availabilityQuality: quality,
          observedAt: fetchedAt,
          sourceFingerprint: businessFingerprint,
        }),
      };

      return version;
    },
  );
  const snapshots = selectIndicatorSnapshots(mapped.records);
  mapped.errors.push(...snapshots.errors);

  const result = completeResponse({
    pages,
    table: 'FinaIndicatorVersion',
    ...mapped,
    allowEmpty: true,
    observedDates: [...new Set(mapped.records.map((record) => String(record.values.endDate)))],
  });
  result.tables.push({ table: 'FinaIndicator', records: snapshots.records });
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
  tsCode?: string;
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
  const where = {
    endDate: period,
    reportType,
    tsCode: identity.tsCode ?? {
      in: [...new Set(rows.map((row) => canonicalStockCode(String(row.ts_code))))],
    },
  };
  const existing = await loadStoredStatements(database, statementKind, where);
  const fields = FINANCIAL_STATEMENT_FIELDS.filter(
    (field) => field.statementKind === statementKind,
  );
  for (const stored of existing) {
    // 旧记录没有来源证据时，不把已规范化代码误认成新来源。
    // Never infer a successor origin from a canonicalized legacy row.
    if (!stored.sourceTsCode && hasStockCodePredecessor(stored.tsCode)) {
      continue;
    }
    const sourceRow = Object.fromEntries(
      [
        ['ts_code', stored.sourceTsCode ?? stored.tsCode],
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
              .map(latestFinancialAnnouncementDate)
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
  const announcementDate = latestFinancialAnnouncementDate(row);
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
    sourceTsCode: row.tsCode,
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
  where: { endDate: string; reportType: string; tsCode?: string | { in: string[] } },
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

/**
 * 单证券完整历史确定来源起点，旧代码一并查询；不猜上市前财务起点。
 *
 * Discover natural financial history per security, including aliases, without guessing a pre-IPO cutoff.
 * Source parameters: https://tushare.pro/document/2?doc_id=33 and doc_id=79.
 */
async function fetchFinancialHistory(
  source: SyncSource,
  api: string,
  code: string,
  fields: string,
  extra: Record<string, unknown> = {},
): Promise<SourcePages> {
  const codes = stockSourceCodes(code);
  const pages: SourcePages = { rows: [], complete: true, pages: 0, errors: [] };
  for (const tsCode of codes) {
    const response = await fetchSourcePages(
      source,
      api,
      { ts_code: tsCode, ...extra },
      fields,
      100,
    );
    pages.rows.push(...response.rows);
    pages.errors.push(...response.errors);
    pages.pages += response.pages;
    pages.complete &&= response.complete;
    pages.deferred ||= response.deferred;
    if (response.deferred) {
      break;
    }
  }

  return pages;
}

const INDICATOR_COLUMNS = {
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

/** 财务下载不读取版本、分红身份或合并上下文。 / Download financial rows without reading versions or merge identities. */
export async function downloadFinancialPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<SourcePages> {
  switch (partition.dataset) {
    case 'financial-statements': {
      const [kind, reportType, historyCode] = partition.scope.split('|');
      const statementKind = kind as FinancialStatementKind;
      const api = FINANCIAL_STATEMENT_APIS[statementKind];
      const fields = financialStatementSourceFields(statementKind).join(',');
      if (historyCode) {
        return fetchFinancialHistory(source, api, historyCode, fields, { report_type: reportType });
      }
      if (partition.announcementRange) {
        return fetchStatementAnnouncementRange(source, api, partition, fields, reportType);
      }

      return fetchSourcePages(
        source,
        api,
        { [partition.announcementField ?? 'period']: partition.startDate, report_type: reportType },
        fields,
        5000,
      );
    }
    case 'financial-indicators': {
      const fields = `${Object.values(INDICATOR_COLUMNS).join(',')},update_flag`;

      return partition.fullHistory
        ? fetchFinancialHistory(source, 'fina_indicator_vip', partition.scope, fields)
        : fetchSourcePages(
            source,
            'fina_indicator_vip',
            { period: partition.startDate },
            fields,
            10000,
          );
    }
    case 'dividends': {
      const dateField = DIVIDEND_DATE_FIELDS.find((field) => field === partition.scope);
      const requests = dateField
        ? [{ [dateField]: partition.startDate }]
        : stockSourceCodes(partition.scope).map((ts_code) => ({ ts_code }));
      const pages: SourcePages = { rows: [], complete: true, pages: 0, errors: [] };
      for (const request of requests) {
        const response = await fetchSourcePages(
          source,
          'dividend',
          request,
          DIVIDEND_SOURCE_FIELDS,
        );
        pages.rows.push(...response.rows);
        pages.errors.push(...response.errors);
        pages.pages += response.pages;
        pages.complete &&= response.complete;
        pages.deferred ||= response.deferred;
        if (response.deferred) {
          break;
        }
      }
      return pages;
    }
    default:
      throw new Error(`Unknown financial dataset ${partition.dataset}`);
  }
}
