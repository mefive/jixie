import { isObservationDate } from '../synchronization/date.js';
import { qualifySessionSeries } from '../calendar/coverage.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  validateSourceBar,
  validateSourceNumbers,
  type SyncSource,
} from '../synchronization/source.js';

/**
 * 元数据保留来源原有品种语义；缺少基金补充资料不擦除已知字段。
 *
 * Retain fund-category semantics and preserve known fields when enrichment is missing.
 */
export async function prepareEtfPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  if (partition.dataset === 'etf-master') {
    return prepareEtfCatalog(source);
  }
  const definitions = {
    'etf-prices': {
      api: 'fund_daily',
      table: 'EtfDaily',
      columns: {
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
      },
    },
    'etf-adjustments': {
      api: 'fund_adj',
      table: 'EtfAdjFactor',
      columns: { tsCode: 'ts_code', tradeDate: 'trade_date', adjFactor: 'adj_factor' },
    },
  };
  const definition = definitions[partition.dataset as keyof typeof definitions];
  if (!definition) {
    throw new Error(`Unknown ETF dataset ${partition.dataset}`);
  }
  const pages = await fetchSourcePages(
    source,
    definition.api,
    { ts_code: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(definition.columns).join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    const date = sourceString(row, 'trade_date');
    if (
      !isObservationDate(date) ||
      row.ts_code !== partition.scope ||
      date < partition.startDate ||
      date > partition.endDate
    ) {
      throw new Error('Invalid ETF identity/date');
    }
    const values = sourceValues(row, definition.columns);
    validateSourceNumbers(values, ['open', 'high', 'low', 'close', 'adjFactor'], ['vol', 'amount']);
    if (definition.table === 'EtfDaily') {
      validateSourceBar(values);
    }
    if (
      definition.table === 'EtfAdjFactor' &&
      (typeof row.adj_factor !== 'number' || row.adj_factor <= 0)
    ) {
      throw new Error('Invalid ETF adjustment');
    }

    return { values };
  });

  const prepared = completeResponse({
    pages,
    table: definition.table,
    coverageComplete: true,
    replace: true,
    allowEmpty: true,
    ...mapped,
    observedDates: mapped.records.map((record) => String(record.values.tradeDate)),
  });

  return qualifySessionSeries(partition, prepared);
}

/**
 * 完整业务操作独立于每日序列。
 *
 * This complete business operation is independent of daily series.
 */
async function prepareEtfCatalog(source: SyncSource): Promise<PreparedMarketPartition> {
  const columns = {
    tsCode: 'ts_code',
    fullName: 'cname',
    indexCode: 'index_code',
    indexName: 'index_name',
    setupDate: 'setup_date',
    listDate: 'list_date',
    listStatus: 'list_status',
    exchange: 'exchange',
    managerName: 'mgr_name',
    custodianName: 'custod_name',
    managementFee: 'mgt_fee',
    etfType: 'etf_type',
  };
  const pages = await fetchSourcePages(
    source,
    'etf_basic',
    {},
    `${Object.values(columns).join(',')},csname,extname`,
    5000,
  );
  const funds = await fetchSourcePages(
    source,
    'fund_basic',
    { market: 'E' },
    'ts_code,name,fund_type,list_date,delist_date,status',
  );
  pages.errors.push(...funds.errors);
  if (!funds.complete) {
    pages.errors.push('ETF fund-category enrichment is incomplete');
  }
  const fundByCode = new Map(funds.rows.map((row) => [row.ts_code, row]));

  // 待上市资料不进入目录映射，避免缺少交易字段阻断上市／退市目录。
  // Exclude pending listings before mapping so incomplete trading fields cannot block the catalog.
  const retained = pages.rows.filter((row) => row.list_status !== 'P');
  const mapped = mapSourceRecords(retained, (row) => {
    if (row.list_status !== 'L' && row.list_status !== 'D') {
      throw new Error(`Invalid ETF listing status ${String(row.ts_code)}`);
    }

    const fund = fundByCode.get(row.ts_code);
    const name = row.extname || row.csname || fund?.name;
    if (typeof name !== 'string') {
      throw new Error('Missing ETF name');
    }
    const knownSameDayTurnover =
      row.etf_type === 'QDII' ||
      fund?.fund_type === '债券型' ||
      fund?.fund_type === '货币型' ||
      /黄金|商品期货/.test(name);
    const classificationKnown =
      typeof row.etf_type === 'string' && typeof fund?.fund_type === 'string';
    const values = {
      ...sourceValues(row, columns),
      name,
      ...(fund && Object.hasOwn(fund, 'fund_type') ? { fundType: fund.fund_type } : {}),
      ...(fund && Object.hasOwn(fund, 'delist_date') ? { delistDate: fund.delist_date } : {}),
      ...(knownSameDayTurnover || classificationKnown
        ? { sameDayTurnover: knownSameDayTurnover }
        : {}),
      lotSize: 100,
    };

    return {
      values,
      authoritativeNulls: fund && Object.hasOwn(fund, 'delist_date') ? ['delistDate'] : [],
    };
  });

  return completeResponse({
    pages,
    table: 'EtfBasic',
    ...mapped,
    coverageComplete: true,
  });
}
