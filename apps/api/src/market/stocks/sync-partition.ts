import { recordImportIssue } from '../synchronization/diagnostics.js';
import { preferStockSources } from '../instruments/source-selection.js';
import {
  STOCK_LIST_STATUSES,
  stockMarketMembership,
  stockMarketRanges,
} from '../instruments/market-range.js';
import { selectStockLimitRows } from './limit-scope.js';
import { canonicalStockCode, normalizeStockNameSpells } from '../instruments/stock-identity.js';
import { getDatabase } from '#infra/database/prisma.js';
import { isObservationDate } from '../synchronization/date.js';
import type {
  MarketPartition,
  PreparedMarketPartition,
  SourceRecord,
} from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  validateSourceBar,
  type SyncSource,
} from '../synchronization/source.js';

const DAILY_COLUMNS = {
  tsCode: 'ts_code',
  tradeDate: 'trade_date',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  preClose: 'pre_close',
  pctChg: 'pct_chg',
  vol: 'vol',
  amount: 'amount',
};
const BASIC_COLUMNS = {
  tsCode: 'ts_code',
  tradeDate: 'trade_date',
  pe: 'pe',
  peTtm: 'pe_ttm',
  pb: 'pb',
  ps: 'ps',
  psTtm: 'ps_ttm',
  dvRatio: 'dv_ratio',
  dvTtm: 'dv_ttm',
  totalMv: 'total_mv',
  circMv: 'circ_mv',
  turnoverRate: 'turnover_rate',
  turnoverRateF: 'turnover_rate_f',
};

/**
 * 四种股票数据独立请求，辅助数据失败不丢弃合法价格。
 *
 * Fetch four stock datasets independently so auxiliary failures cannot discard prices.
 */
export async function prepareStockPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  const definitions = {
    'stock-prices': { api: 'daily', table: 'Daily', columns: DAILY_COLUMNS },
    'stock-adjustments': {
      api: 'adj_factor',
      table: 'AdjFactor',
      columns: { tsCode: 'ts_code', tradeDate: 'trade_date', adjFactor: 'adj_factor' },
    },
    'stock-valuations': { api: 'daily_basic', table: 'DailyBasic', columns: BASIC_COLUMNS },
    'stock-limits': {
      api: 'stk_limit',
      table: 'StkLimit',
      columns: {
        tsCode: 'ts_code',
        tradeDate: 'trade_date',
        upLimit: 'up_limit',
        downLimit: 'down_limit',
      },
    },
  };
  const definition = definitions[partition.dataset as keyof typeof definitions];
  if (!definition) {
    throw new Error(`Unknown stock dataset ${partition.dataset}`);
  }
  const fields = [...new Set(Object.values(definition.columns))];
  if (partition.dataset === 'stock-limits') {
    fields.push('asset_type', 'exchange');
  }
  const pages = await fetchSourcePages(
    source,
    definition.api,
    { trade_date: partition.startDate },
    fields.join(','),
  );
  const ranges = stockMarketRanges(await getDatabase().stockBasic.findMany());

  // 标的目录是白名单，目录外代码只计正常过滤；目录内记录继续校验日期和业务字段。
  // The catalog is the allowlist: silently filter other codes, then validate admitted dates/values.
  const catalogRows = pages.rows.filter((row) =>
    ranges.has(canonicalStockCode(String(row.ts_code))),
  );

  const limitScope =
    partition.dataset === 'stock-limits'
      ? selectStockLimitRows(catalogRows, partition, ranges)
      : undefined;
  const domainRows =
    limitScope?.rows ??
    catalogRows.filter((row) => {
      const code = String(row.ts_code);
      if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code) || row.trade_date !== partition.startDate) {
        return true;
      }
      return stockMarketMembership(code, partition.startDate, ranges) !== 'outside';
    });
  const inScope = domainRows.filter((row) => {
    const code = String(row.ts_code);
    if (
      !partition.exchanges ||
      !/^\d{6}\.(SH|SZ|BJ)$/.test(code) ||
      row.trade_date !== partition.startDate
    ) {
      return true;
    }
    const exchange = ranges.get(canonicalStockCode(code))?.exchange;

    return !exchange || partition.exchanges.includes(exchange);
  });
  const selected = preferStockSources(
    inScope,
    (row) => `${canonicalStockCode(String(row.ts_code))}/${row.trade_date}`,
    (row) => String(row.ts_code),
  );
  const mapped = mapSourceRecords(selected, (row) => {
    const values = sourceValues(row, definition.columns);
    const code = sourceString(row, 'ts_code');
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code) || row.trade_date !== partition.startDate) {
      throw new Error(`${definition.api}: invalid stock/date ${code}/${row.trade_date}`);
    }
    if (stockMarketMembership(code, partition.startDate, ranges) === 'unknown') {
      throw new Error(`Unrecognized stock identity or market interval ${code}`);
    }
    values.tsCode = canonicalStockCode(code);
    values.sourceTsCode = code;
    if (partition.dataset === 'stock-limits') {
      const listing = ranges.get(canonicalStockCode(code));
      const exchangeConflict =
        listing?.exchange && row.exchange != null && listing.exchange !== row.exchange;
      const assetConflict = listing && row.asset_type != null && row.asset_type !== 'STK';
      if (exchangeConflict || assetConflict) {
        throw new Error(`Conflicting stock identity ${code}: ${row.exchange}/${row.asset_type}`);
      }
    }
    if (definition.table === 'Daily') {
      validateSourceBar(values, row);
    }
    if (
      definition.table === 'AdjFactor' &&
      (typeof values.adjFactor !== 'number' || values.adjFactor <= 0)
    ) {
      throw new Error(`Invalid adjustment ${code}`);
    }
    if (
      definition.table === 'StkLimit' &&
      (typeof values.upLimit !== 'number' ||
        typeof values.downLimit !== 'number' ||
        values.upLimit < 0 ||
        values.downLimit < 0 ||
        values.upLimit < values.downLimit)
    ) {
      throw new Error(`Invalid price limits ${code}`);
    }

    return {
      values,
      authoritativeNulls:
        definition.table === 'DailyBasic'
          ? Object.keys(values).filter((field) => values[field] === null)
          : [],
    };
  });

  const prepared = completeResponse({
    pages,
    table: definition.table,
    ...mapped,
    allowEmpty: true,
    observedDates: mapped.records.length ? [partition.startDate] : [],
  });
  prepared.checks.excludedRows =
    pages.rows.length -
    catalogRows.length +
    (limitScope?.excludedRows ?? catalogRows.length - domainRows.length) +
    domainRows.length -
    inScope.length +
    inScope.length -
    selected.length;
  if (limitScope?.gaps.length) {
    for (const row of limitScope.unrecognizedRows) {
      recordImportIssue({
        category: 'record',
        reasonCode: 'unrecognized_identity',
        message: `Unrecognized stock identity ${row.ts_code}`,
        payload: row,
      });
    }
    prepared.checks.invalidRows += limitScope.unrecognizedRows.length;
    prepared.gaps.push(...limitScope.gaps);
    if (!prepared.errors.length && prepared.status === 'complete') {
      prepared.status = 'partial';
    }
  }

  return prepared;
}

/**
 * 主表各状态分区独立，名称只处理请求的公告范围，不生成今日名称的历史回填。
 *
 * Master statuses are independent; names never backfill today's name into unproven history.
 */
export async function prepareStockReference(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  if (partition.dataset === 'stock-master') {
    if (!STOCK_LIST_STATUSES.some((status) => status === partition.scope)) {
      throw new Error(`Unsupported stock listing status ${partition.scope}`);
    }
    const columns = {
      tsCode: 'ts_code',
      symbol: 'symbol',
      name: 'name',
      area: 'area',
      market: 'market',
      exchange: 'exchange',
      listDate: 'list_date',
      delistDate: 'delist_date',
      listStatus: 'list_status',
    };
    const pages = await fetchSourcePages(
      source,
      'stock_basic',
      { list_status: partition.scope },
      Object.values(columns).join(','),
    );
    const mapped = mapSourceRecords(pages.rows, (row) => {
      if (
        row.list_status !== partition.scope ||
        !['SSE', 'SZSE', 'BSE'].includes(String(row.exchange)) ||
        !/^(?:\d{6}|T\d{6})\.(SH|SZ|BJ)$/.test(sourceString(row, 'ts_code'))
      ) {
        throw new Error('Invalid stock master identity');
      }

      return { values: sourceValues(row, columns), authoritativeNulls: ['delistDate'] };
    });
    // 状态迁移不是证券删除；保留从另一个状态暂时缺失的历史身份。
    // A status transition is not a security deletion; preserve historical identities
    // between status fetches.
    return completeResponse({
      pages,
      table: 'StockBasic',
      ...mapped,
      allowEmpty: partition.scope !== 'L',
    });
  }

  const columns = {
    tsCode: 'ts_code',
    name: 'name',
    startDate: 'start_date',
    endDate: 'end_date',
    announcementDate: 'ann_date',
    changeReason: 'change_reason',
  };
  const pages = await fetchSourcePages(
    source,
    'namechange',
    { start_date: partition.startDate, end_date: partition.endDate },
    Object.values(columns).join(','),
  );
  const selected = preferStockSources(
    pages.rows,
    (row) => `${canonicalStockCode(String(row.ts_code))}/${row.start_date}`,
    (row) => String(row.ts_code),
  );
  const mapped = mapSourceRecords(selected, (row) => {
    const startDate = sourceString(row, 'start_date');
    if (
      !isObservationDate(startDate) ||
      (typeof row.ann_date === 'string' &&
        (!isObservationDate(row.ann_date) ||
          row.ann_date < partition.startDate ||
          row.ann_date > partition.endDate))
    ) {
      throw new Error('Unexpected name-history extent');
    }

    return {
      values: {
        ...sourceValues(row, columns),
        tsCode: canonicalStockCode(sourceString(row, 'ts_code')),
        sourceTsCode: sourceString(row, 'ts_code'),
      },
    };
  });
  const byCode = new Map<string, SourceRecord[]>();
  for (const record of mapped.records) {
    const code = String(record.values.tsCode);
    byCode.set(code, [...(byCode.get(code) ?? []), record]);
  }
  mapped.records = [];
  for (const records of byCode.values()) {
    try {
      mapped.records.push(...normalizeNameRecords(records));
    } catch (error) {
      mapped.errors.push(String(error));
    }
  }

  return completeResponse({
    pages,
    table: 'StockNameHistory',
    replace: false,
    ...mapped,
    allowEmpty: true,
  });
}

/**
 * 同一证券的名称区间一起规范化，单个证券冲突不阻塞其他名称历史。
 *
 * Normalize one security's name intervals without blocking unrelated histories on a conflict.
 */
function normalizeNameRecords(records: SourceRecord[]): SourceRecord[] {
  const spells = normalizeStockNameSpells(
    records.map((record) => ({
      tsCode: String(record.values.tsCode),
      sourceTsCode: String(record.values.sourceTsCode),
      name: String(record.values.name),
      startDate: String(record.values.startDate),
      endDate: typeof record.values.endDate === 'string' ? record.values.endDate : null,
    })),
  );
  const byDate = new Map(spells.map((spell) => [spell.startDate, spell]));

  return records
    .filter((record) => byDate.has(String(record.values.startDate)))
    .map((record) => ({
      ...record,
      authoritativeNulls: ['endDate'],
      values: { ...record.values, endDate: byDate.get(String(record.values.startDate))!.endDate },
    }));
}
