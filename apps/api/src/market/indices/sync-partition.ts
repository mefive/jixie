import { canonicalStockCode } from '../instruments/stock-identity.js';
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
  type SyncSource,
} from '../synchronization/source.js';

/**
 * 成分按完整快照原子接纳；日价格和估值不相互阻塞。
 *
 * Admit constituents as atomic snapshots; prices and valuations progress independently.
 */
export async function prepareIndexPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  if (partition.dataset === 'index-weights') {
    const pages = await fetchSourcePages(
      source,
      'index_weight',
      { index_code: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
      'index_code,con_code,trade_date,weight',
    );
    const groups = new Map<string, typeof pages.rows>();
    for (const row of pages.rows) {
      const date = String(row.trade_date);
      groups.set(date, [...(groups.get(date) ?? []), row]);
    }

    const records: SourceRecord[] = [];
    const errors: string[] = [];
    const completeDates: string[] = [];

    for (const [date, rows] of groups) {
      const snapshot = mapSourceRecords(rows, (row) => ({
        values: {
          indexCode: sourceString(row, 'index_code'),
          conCode: canonicalStockCode(sourceString(row, 'con_code')),
          tradeDate: sourceString(row, 'trade_date'),
          weight: row.weight,
        },
        availabilityQuality: 'latest_only',
      }));
      const codes = new Set(snapshot.records.map((record) => record.values.conCode));
      const sum = snapshot.records.reduce(
        (total, record) => total + Number(record.values.weight),
        0,
      );

      if (
        !pages.complete ||
        snapshot.errors.length > 0 ||
        date < partition.startDate ||
        date > partition.endDate ||
        codes.size !== rows.length ||
        rows.some(
          (row) =>
            row.index_code !== partition.scope ||
            typeof row.weight !== 'number' ||
            !Number.isFinite(row.weight) ||
            row.weight < 0 ||
            row.weight > 100,
        ) ||
        sum < 95 ||
        sum > 105
      ) {
        errors.push(`Incomplete or invalid constituent snapshot ${partition.scope}/${date}`);
        continue;
      }

      completeDates.push(date);
      records.push(...snapshot.records);
    }

    const prepared = completeResponse({
      pages,
      table: 'IndexWeight',
      extent: { basis: 'Unique constituents with a validated total weight' },
      records,
      errors,
      observedDates: completeDates,
    });
    prepared.tables = completeDates.map((date) => ({
      table: 'IndexWeight',
      atomic: true,
      records: records.filter((record) => record.values.tradeDate === date),
      replacementRequest: {
        basis: 'Validated complete constituent snapshot',
        independent: true,
        where: { indexCode: partition.scope, tradeDate: date },
      },
    }));

    return prepared;
  }
  if (partition.dataset === 'industry-members') {
    const current = await fetchSourcePages(
      source,
      'index_member_all',
      { l1_code: partition.scope, is_new: 'Y' },
      'l1_code,l1_name,ts_code,in_date,out_date,is_new',
    );
    const historic = await fetchSourcePages(
      source,
      'index_member_all',
      { l1_code: partition.scope, is_new: 'N' },
      'l1_code,l1_name,ts_code,in_date,out_date,is_new',
    );
    const pages = {
      rows: [...current.rows, ...historic.rows],
      complete: current.complete && historic.complete,
      pages: current.pages + historic.pages,
      errors: [...current.errors, ...historic.errors],
    };
    const mapped = mapSourceRecords(pages.rows, (row) => {
      if (row.l1_code !== partition.scope) {
        throw new Error('Industry membership scope mismatch');
      }

      return {
        values: {
          tsCode: canonicalStockCode(sourceString(row, 'ts_code')),
          l1Code: sourceString(row, 'l1_code'),
          l1Name: sourceString(row, 'l1_name'),
          inDate: sourceString(row, 'in_date'),
          outDate: row.out_date ?? null,
        },
        authoritativeNulls: Object.hasOwn(row, 'out_date') ? ['outDate'] : [],
        availabilityQuality: 'latest_only',
      };
    });

    return completeResponse({
      pages,
      table: 'SwIndustryMember',
      extent: {
        basis: 'Current and historical membership contracts',
        deletion: 'Complete current and historical membership extent',
      },
      ...mapped,
      where: { l1Code: partition.scope },
    });
  }

  const definitions = {
    'index-catalog': {
      api: 'mkt_idx_bmk',
      table: 'IndexBenchmark',
      columns: {
        tsCode: 'ts_code',
        symbol: 'symbol',
        name: 'name',
        fullName: 'fullname',
        bmkLevel: 'bmk_level',
        bmkType: 'bmk_type',
        bmkSource: 'bmk_src',
        indexType: 'idx_type',
      },
    },
    'index-prices': {
      api: 'index_daily',
      table: 'IndexDaily',
      columns: { tsCode: 'ts_code', tradeDate: 'trade_date', close: 'close' },
    },
    'index-valuations': {
      api: 'index_dailybasic',
      table: 'IndexDailyBasic',
      columns: {
        tsCode: 'ts_code',
        tradeDate: 'trade_date',
        totalMv: 'total_mv',
        floatMv: 'float_mv',
        totalShare: 'total_share',
        floatShare: 'float_share',
        freeShare: 'free_share',
        turnoverRate: 'turnover_rate',
        turnoverRateF: 'turnover_rate_f',
        pe: 'pe',
        peTtm: 'pe_ttm',
        pb: 'pb',
      },
    },
    'industry-prices': {
      api: 'sw_daily',
      table: 'SwIndexDaily',
      columns: {
        tsCode: 'ts_code',
        tradeDate: 'trade_date',
        name: 'name',
        open: 'open',
        high: 'high',
        low: 'low',
        close: 'close',
        change: 'change',
        pctChange: 'pct_change',
        volume: 'vol',
        amount: 'amount',
        pe: 'pe',
        pb: 'pb',
        floatMv: 'float_mv',
        totalMv: 'total_mv',
      },
    },
  };
  const definition = definitions[partition.dataset as keyof typeof definitions];
  if (!definition) {
    throw new Error(`Unknown index dataset ${partition.dataset}`);
  }
  const catalog = partition.dataset === 'index-catalog';
  const pages = await fetchSourcePages(
    source,
    definition.api,
    catalog
      ? {}
      : { ts_code: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(definition.columns).join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (
      !catalog &&
      (row.ts_code !== partition.scope ||
        typeof row.trade_date !== 'string' ||
        row.trade_date < partition.startDate ||
        row.trade_date > partition.endDate)
    ) {
      throw new Error(`Invalid ${definition.api} identity/date`);
    }
    if ('close' in definition.columns && (typeof row.close !== 'number' || row.close <= 0)) {
      throw new Error(`Invalid ${definition.api} close`);
    }

    return {
      values: sourceValues(row, definition.columns),
      availableDate: typeof row.trade_date === 'string' ? row.trade_date : null,
      availabilityQuality: catalog ? 'latest_only' : 'source_contract',
    };
  });

  return completeResponse({
    pages,
    table: definition.table,
    extent: {
      basis: 'Filtered index source contract',
      deletion: 'Exact index series after session qualification',
    },
    ...mapped,
    observedDates: mapped.records.flatMap((record) =>
      typeof record.values.tradeDate === 'string' ? [record.values.tradeDate] : [],
    ),
    ...(!catalog
      ? {
          where: {
            tsCode: partition.scope,
            tradeDate: { gte: partition.startDate, lte: partition.endDate },
          },
        }
      : {}),
  });
}
