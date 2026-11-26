import { recordImportIssue, recordImportRequest } from './diagnostics.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { TusharePaginator } from '../providers/tushare/tushare-paginator.js';
import { MarketSourceStorageError, MarketSyncBudgetError, TushareError } from '../errors.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import type { MarketRow, PreparedMarketPartition, SourceRecord } from './partition.js';

export interface SyncSource {
  tracksHttp?: boolean;
  call(api: string, params?: Record<string, unknown>, fields?: string): Promise<TushareRow[]>;
}

export interface SourcePages {
  rows: TushareRow[];
  complete: boolean;
  pages: number;
  deferred?: boolean;
  errors: string[];
}
const discarding = new AsyncLocalStorage<boolean>();

/** 预取仅保留完整性状态，原始页由缓冲管理。 / Prefetch retains integrity state; the buffer owns raw pages. */
export function withoutSourceRowAccumulation<Result>(operation: () => Promise<Result>) {
  return discarding.run(true, operation);
}

/**
 * 记录逻辑请求；原始分页由公共分页器执行，收据标识与传输页数无关。
 *
 * Record one logical request while the shared paginator manages transport pages.
 */
export async function fetchSourcePages(
  source: SyncSource,
  api: string,
  params: Record<string, unknown>,
  fields: string,
): Promise<SourcePages> {
  recordImportRequest(api, params, fields);
  const result: SourcePages = { rows: [], complete: false, pages: 0, errors: [] };
  let offset = 0;
  try {
    const paginator = new TusharePaginator(source);
    for await (const page of paginator.pages(api, params, fields)) {
      result.pages++;
      offset += page.length;
      if (!discarding.getStore()) {
        result.rows.push(...page);
      }
    }
    result.complete = true;
  } catch (error) {
    if (error instanceof MarketSourceStorageError) {
      throw error;
    }
    if (error instanceof MarketSyncBudgetError) {
      result.deferred = true;
      return result;
    }

    const message = `${api} offset=${offset}: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(message);
    recordImportIssue({
      category: 'request',
      reasonCode:
        error instanceof TushareError ? 'source_rejected_request' : 'source_request_failed',
      message,
    });
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
