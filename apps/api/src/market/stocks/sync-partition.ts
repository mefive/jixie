import { canonicalStockCode, normalizeStockNameSpells } from '../instruments/stock-identity.js';
import { getDatabase } from '#infra/database/prisma.js';
import { isObservationDate } from '../synchronization/date.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  validateSourceNumbers,
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
  const pages = await fetchSourcePages(
    source,
    definition.api,
    { trade_date: partition.startDate },
    [...new Set(Object.values(definition.columns))].join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    const values = sourceValues(row, definition.columns);
    const code = sourceString(row, 'ts_code');
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code) || row.trade_date !== partition.startDate) {
      throw new Error(`${definition.api}: invalid stock/date ${code}/${row.trade_date}`);
    }
    values.tsCode = canonicalStockCode(code);
    if (definition.table === 'Daily') {
      validateSourceNumbers(values, ['open', 'high', 'low', 'close'], ['vol', 'amount']);
      if (
        typeof values.close !== 'number' ||
        values.close <= 0 ||
        (typeof values.high === 'number' &&
          typeof values.low === 'number' &&
          values.high < values.low) ||
        [values.vol, values.amount].some((value) => typeof value === 'number' && value < 0)
      ) {
        throw new Error(`Invalid daily bar ${code}/${partition.startDate}`);
      }
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
        values.upLimit <= 0 ||
        values.downLimit <= 0 ||
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
    coverageComplete: false,
    ...mapped,
    allowEmpty: false,
    observedDates: mapped.records.length ? [partition.startDate] : [],
  });

  if (partition.dataset === 'stock-prices') {
    const suspensions = await fetchSourcePages(
      source,
      'suspend_d',
      { trade_date: partition.startDate, suspend_type: 'S' },
      'ts_code,trade_date,suspend_type,suspend_timing',
    );
    const suspended = mapSourceRecords(suspensions.rows, (row) => {
      const code = sourceString(row, 'ts_code');
      if (
        !/^\d{6}\.(SH|SZ|BJ)$/.test(code) ||
        row.trade_date !== partition.startDate ||
        row.suspend_type !== 'S'
      ) {
        throw new Error('Invalid daily suspension evidence');
      }

      return { values: { tsCode: canonicalStockCode(code), timing: row.suspend_timing ?? null } };
    });
    prepared.errors.push(...suspensions.errors, ...suspended.errors);
    prepared.checks.suspensionsVerified =
      suspensions.complete && !suspensions.errors.length && !suspended.errors.length;
    prepared.checks.fullDaySuspended = suspended.records
      .filter((record) => !record.values.timing)
      .map((record) => String(record.values.tsCode));
  }

  return prepared;
}

/**
 * 上市区间与全天停牌共同证明行情截面；其他稠密来源覆盖已核验的交易证券。
 *
 * Listing intervals and full-day suspensions prove prices; other dense sources cover verified
 * trades.
 * Suspension contract: https://tushare.pro/document/2?doc_id=214
 */
export async function stockPartitionCoverage(
  partition: MarketPartition,
  prepared: PreparedMarketPartition,
): Promise<string[]> {
  const database = getDatabase();
  const codes = new Set(
    prepared.tables.flatMap((table) => table.records.map((row) => row.values.tsCode)),
  );
  if (partition.dataset !== 'stock-prices') {
    const priceProof = await database.datasetSyncPartition.findFirst({
      where: {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: partition.startDate,
        endDate: partition.endDate,
        status: 'complete',
      },
    });
    const prices = await database.daily.findMany({
      where: { tradeDate: partition.startDate },
      select: { tsCode: true },
    });

    return !priceProof || !prices.length || prices.some((row) => !codes.has(row.tsCode))
      ? ['Same-day verified traded-security coverage is incomplete']
      : [];
  }

  const masters = await database.datasetSyncPartition.findMany({
    where: { dataset: 'stock-master', status: 'complete' },
    select: { scope: true },
  });
  if (['L', 'D', 'P', 'G'].some((scope) => !masters.some((row) => row.scope === scope))) {
    return ['Listing-status inventories are not verified'];
  }
  if (prepared.checks.suspensionsVerified !== true) {
    return ['Full-day suspension evidence is unavailable'];
  }

  const stocks = await database.stockBasic.findMany();
  if (!stocks.length || stocks.some((stock) => !stock.listDate && stock.listStatus !== 'G')) {
    return ['Historical listing intervals are unknown'];
  }
  const listed = new Set(
    stocks
      .filter(
        (stock) =>
          stock.listDate &&
          stock.listDate <= partition.startDate &&
          (!stock.delistDate || stock.delistDate >= partition.startDate),
      )
      .map((stock) => canonicalStockCode(stock.tsCode)),
  );
  const suspended = new Set(prepared.checks.fullDaySuspended ?? []);
  const missing = [...listed].filter((code) => !codes.has(code) && !suspended.has(code));
  const unexpected = [...codes].filter((code) => typeof code !== 'string' || !listed.has(code));
  const contradictions = [...codes].filter(
    (code) => typeof code === 'string' && suspended.has(code),
  );

  return missing.length || unexpected.length || contradictions.length
    ? [
        `Unproven stock price extent: ${missing.length} missing, ${unexpected.length} outside listing intervals, ${contradictions.length} conflicting suspensions`,
      ]
    : [];
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
    const columns = {
      tsCode: 'ts_code',
      symbol: 'symbol',
      name: 'name',
      area: 'area',
      market: 'market',
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
        !/^\d{6}\.(SH|SZ|BJ)$/.test(sourceString(row, 'ts_code'))
      ) {
        throw new Error('Invalid stock master identity');
      }

      return { values: sourceValues(row, columns) };
    });
    // 状态迁移不是证券删除；保留从另一个状态暂时缺失的历史身份。
    // A status transition is not a security deletion; preserve historical identities between status fetches.
    return completeResponse({
      pages,
      table: 'StockBasic',
      coverageComplete: true,
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
  const mapped = mapSourceRecords(pages.rows, (row) => {
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
      },
    };
  });
  const spells = normalizeStockNameSpells(
    mapped.records.map((record) => ({
      tsCode: String(record.values.tsCode),
      name: String(record.values.name),
      startDate: String(record.values.startDate),
      endDate: typeof record.values.endDate === 'string' ? record.values.endDate : null,
    })),
  );
  const byKey = new Map(spells.map((spell) => [`${spell.tsCode}|${spell.startDate}`, spell]));
  mapped.records = mapped.records
    .filter((record) => byKey.has(`${record.values.tsCode}|${record.values.startDate}`))
    .map((record) => ({
      ...record,
      values: {
        ...record.values,
        endDate: byKey.get(`${record.values.tsCode}|${record.values.startDate}`)!.endDate,
      },
    }));

  return completeResponse({
    pages,
    table: 'StockNameHistory',
    coverageComplete: true,
    replace: true,
    ...mapped,
    allowEmpty: true,
  });
}
