import { recordImportIssue, recordImportRequest } from './diagnostics.js';
import { createHash } from 'node:crypto';
import { INGESTION_SOURCE_REQUESTS } from '../providers/tushare/request-contract.js';
import { MarketSyncBudgetError, TushareError } from '../errors.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import type { MarketRow, PreparedMarketPartition, SourceRecord } from './partition.js';

export interface SyncSource {
  call(api: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface SourcePages {
  rows: TushareRow[];
  complete: boolean;
  pages: number;
  deferred?: boolean;
  errors: string[];
}

/**
 * 分页完整性独立报告；调度器只提交整批下载完成的数据。
 *
 * Report pagination completeness separately; the orchestrator commits only complete downloads.
 */
export async function fetchSourcePages(
  source: SyncSource,
  api: string,
  params: Record<string, unknown>,
  fields: string,
  requestedPageSize?: number,
  maximumPages = 20,
): Promise<SourcePages> {
  const contract = INGESTION_SOURCE_REQUESTS[api];
  if (
    !contract ||
    Object.keys(params).some((parameter) => !contract.parameters.includes(parameter))
  ) {
    throw new Error(`${api}: undeclared ingestion request parameter`);
  }
  recordImportRequest(api, params, fields);

  const pageSize = Math.min(
    requestedPageSize ?? contract.pageSize ?? 1000,
    contract.pageSize ?? Infinity,
  );
  const snapshotLimit =
    !contract.snapshotParameter || Object.hasOwn(params, contract.snapshotParameter)
      ? contract.snapshotLimit
      : undefined;
  const result: SourcePages = { rows: [], complete: false, pages: 0, errors: [] };
  const signatures = new Set<string>();
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
    try {
      const page = await source.call(
        api,
        snapshotLimit ? params : { ...params, limit: pageSize, offset: pageNumber * pageSize },
        fields,
      );
      result.pages++;
      const signature = createHash('sha256').update(JSON.stringify(page)).digest('hex');
      if (page.length && signatures.has(signature)) {
        throw new Error(`${api}: provider repeated an offset page`);
      }
      signatures.add(signature);
      result.rows.push(...page);
      if (snapshotLimit && page.length >= snapshotLimit) {
        throw new Error(`${api}: response reached its safety limit; narrow the request`);
      }
      if (snapshotLimit || page.length < pageSize) {
        result.complete = true;
        break;
      }
    } catch (error) {
      if (error instanceof MarketSyncBudgetError) {
        result.deferred = true;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      recordImportIssue({
        category: 'request',
        reasonCode:
          error instanceof TushareError ? 'source_rejected_request' : 'source_request_failed',
        message,
      });
      break;
    }
  }
  if (!result.complete && !result.deferred && !result.errors.length) {
    const message = `${api}: finite pagination limit reached`;
    result.errors.push(message);
    recordImportIssue({ category: 'request', reasonCode: 'incomplete_pagination', message });
  }

  return result;
}

export function sourceString(row: TushareRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing source identity ${field}`);
  }

  return value;
}

/**
 * 显式来源映射只保留实际返回的字段。
 *
 * Explicit source mappings preserve only fields actually returned.
 */
export function sourceValues(
  row: TushareRow,
  columns: Readonly<Record<string, string>>,
): MarketRow {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([, source]) => Object.hasOwn(row, source))
      .map(([destination, source]) => [destination, row[source]]),
  );
}

/**
 * 分页结束只描述传输；领域范围校验和最终交易日核验共同决定是否可替换。
 *
 * Pagination describes transport only; domain bounds and final session qualification control
 * replacement.
 */
export function completeResponse(input: {
  pages: SourcePages;
  table: string;
  records: SourceRecord[];
  replace?: boolean;
  observedDates?: string[];
  allowEmpty?: boolean;
  errors?: string[];
}): PreparedMarketPartition {
  const errors = [...input.pages.errors, ...(input.errors ?? [])];
  const received = input.pages.rows.length;
  if (!input.records.length && !input.allowEmpty && !errors.length && !input.pages.deferred) {
    errors.push(`${input.table}: unexplained empty source response`);
  }
  const complete = input.pages.complete && !errors.length;

  return {
    tables: [
      {
        table: input.table,
        records: input.records,
        ...(complete && input.replace
          ? {
              replace: true,
            }
          : {}),
      },
    ],
    status: errors.length
      ? 'error'
      : input.pages.deferred
        ? 'waiting'
        : complete
          ? 'complete'
          : 'partial',
    checks: {
      terminalPage: input.pages.complete,
      emptyResponse: received === 0,
      sourceFailed: input.pages.errors.length > 0,
      invalidRows: input.errors?.length ?? 0,
      pages: input.pages.pages,
      sourceRows: received,
      excludedRows: Math.max(0, received - input.records.length - (input.errors?.length ?? 0)),
    },
    observedDates: input.observedDates ?? [],
    gaps: complete ? [] : [`${input.table}: source extent is unfinished`],
    errors,
  };
}

/**
 * 一个坏对象不丢弃其他独立对象，错误随分区返回。
 *
 * A bad object does not discard independent objects; errors travel with the partition.
 */
export function mapSourceRecords(
  rows: TushareRow[],
  map: (row: TushareRow) => SourceRecord,
): { records: SourceRecord[]; errors: string[] } {
  const records: SourceRecord[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    try {
      records.push({ ...map(row), raw: row });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      recordImportIssue({
        category:
          error instanceof TypeError || error instanceof ReferenceError ? 'internal' : 'record',
        reasonCode: 'record_not_accepted',
        message,
        payload: row,
      });
    }
  }

  return { records, errors };
}

/**
 * 只校验实际返回的数值，不把省略或未知 null 改成零。
 *
 * Validate returned numbers without turning omitted or unknown fields into zero.
 */
export function validateSourceNumbers(
  values: MarketRow,
  positive: readonly string[],
  nonnegative: readonly string[] = [],
): void {
  for (const [fields, minimumExclusive] of [
    [positive, true],
    [nonnegative, false],
  ] as const) {
    for (const field of fields) {
      const value = values[field];
      if (
        value != null &&
        (typeof value !== 'number' ||
          !Number.isFinite(value) ||
          (minimumExclusive ? value <= 0 : value < 0))
      ) {
        throw new Error(`Invalid source number ${field}`);
      }
    }
  }
}

/**
 * 股票和 ETF 保留可存储价格；OHLC 范围矛盾只记录来源警告。
 *
 * Validate storable stock/ETF prices and record OHLC range inconsistencies as source warnings.
 */
export function validateSourceBar(values: MarketRow, sourceRow?: TushareRow): void {
  const prices = ['open', 'high', 'low', 'close'].map((field) => values[field]);
  if (prices.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    throw new Error('Missing or invalid OHLC price');
  }

  validateSourceNumbers(values, [], ['vol', 'amount']);

  const [open, high, low, close] = prices as number[];
  if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
    recordImportIssue({
      severity: 'warning',
      category: 'record',
      reasonCode: 'ohlc_range_inconsistent',
      message: 'Inconsistent OHLC price range',
      businessKey: { tsCode: values.tsCode, tradeDate: values.tradeDate },
      field: 'ohlc',
      payload: sourceRow ?? values,
    });
  }
}
