import { getDatabase } from '#infra/database/prisma.js';
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
    );
    const funds = await fetchSourcePages(
      source,
      'fund_basic',
      { market: 'E' },
      'ts_code,name,fund_type,list_date,delist_date,status',
    );
    pages.errors.push(...funds.errors);
    const fundByCode = new Map(funds.rows.map((row) => [row.ts_code, row]));
    const mapped = mapSourceRecords(pages.rows, (row) => {
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
        availabilityQuality: 'latest_only',
      };
    });

    return completeResponse({
      pages,
      table: 'EtfBasic',
      ...mapped,
      extent: { basis: 'Filtered fund catalog contract' },
    });
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
    'etf-shares': {
      api: 'etf_share_size',
      table: 'EtfShareSize',
      columns: {
        tsCode: 'ts_code',
        tradeDate: 'trade_date',
        totalShare: 'total_share',
        totalSize: 'total_size',
        nav: 'nav',
        close: 'close',
        exchange: 'exchange',
      },
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
  const dates = await getDatabase().tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: partition.startDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  const mapped = mapSourceRecords(pages.rows, (row) => {
    const date = sourceString(row, 'trade_date');
    if (row.ts_code !== partition.scope || date < partition.startDate || date > partition.endDate) {
      throw new Error('Invalid ETF identity/date');
    }
    const values = sourceValues(row, definition.columns);
    validateSourceNumbers(
      values,
      ['open', 'high', 'low', 'close', 'nav', 'adjFactor'],
      ['vol', 'amount', 'totalShare', 'totalSize'],
    );
    if (definition.table === 'EtfDaily' && (typeof row.close !== 'number' || row.close <= 0)) {
      throw new Error('Invalid ETF close');
    }
    if (
      definition.table === 'EtfAdjFactor' &&
      (typeof row.adj_factor !== 'number' || row.adj_factor <= 0)
    ) {
      throw new Error('Invalid ETF adjustment');
    }
    const availableDate =
      definition.table === 'EtfShareSize'
        ? dates.find((entry) => entry.calDate > date)?.calDate
        : date;
    if (!availableDate) {
      throw new Error(`Missing next SSE session for ${date}`);
    }
    if (definition.table === 'EtfShareSize') {
      if (typeof row.total_share !== 'number' || row.total_share < 0) {
        throw new Error('Invalid ETF units');
      }
      values.availableDate = availableDate;
      values.retrievedAt = new Date();
    }

    return { values, availableDate, availabilityQuality: 'source_contract' };
  });

  return completeResponse({
    pages,
    table: definition.table,
    extent: {
      basis: 'Filtered fund series contract',
      deletion: 'Exact dated fund observations after session qualification',
    },
    ...mapped,
    observedDates: mapped.records.map((record) => String(record.values.tradeDate)),
    where: {
      tsCode: partition.scope,
      tradeDate: { gte: partition.startDate, lte: partition.endDate },
    },
  });
}
