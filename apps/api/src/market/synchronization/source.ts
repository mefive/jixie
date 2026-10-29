import { MarketSyncBudgetError } from '../errors.js';
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
 * 分页失败保留已经收到的独立合法记录，永不返回虚假完成。
 *
 * Keep independent received records after page failures without claiming completion.
 */
export async function fetchSourcePages(
  source: SyncSource,
  api: string,
  params: Record<string, unknown>,
  fields: string,
  pageSize = 1000,
  maximumPages = 20,
): Promise<SourcePages> {
  const result: SourcePages = { rows: [], complete: false, pages: 0, errors: [] };
  const signatures = new Set<string>();
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
    try {
      const page = await source.call(
        api,
        { ...params, limit: pageSize, offset: pageNumber * pageSize },
        fields,
      );
      result.pages++;
      const signature = JSON.stringify(page);
      if (page.length && signatures.has(signature)) {
        throw new Error(`${api}: provider repeated an offset page`);
      }
      signatures.add(signature);
      result.rows.push(...page);
      if (page.length < pageSize) {
        result.complete = true;
        break;
      }
    } catch (error) {
      if (error instanceof MarketSyncBudgetError) {
        result.deferred = true;
        break;
      }
      result.errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }
  if (!result.complete && !result.deferred && !result.errors.length) {
    result.errors.push(`${api}: finite pagination limit reached`);
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
  coverageComplete: boolean;
  replace?: boolean;
  observedDates?: string[];
  allowEmpty?: boolean;
  errors?: string[];
}): PreparedMarketPartition {
  const errors = [...input.pages.errors, ...(input.errors ?? [])];
  if (!input.records.length && !input.allowEmpty && !errors.length && !input.pages.deferred) {
    errors.push(`${input.table}: unexplained empty source response`);
  }
  const complete = input.pages.complete && !errors.length && input.coverageComplete;

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
      emptyResponse: input.pages.rows.length === 0,
      sourceFailed: input.pages.errors.length > 0,
      invalidRows: input.errors?.length ?? 0,
      pages: input.pages.pages,
      sourceRows: input.pages.rows.length,
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
      records.push(map(row));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
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
