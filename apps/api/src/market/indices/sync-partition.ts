import { isObservationDate, localDate } from '../synchronization/date.js';
import { DATASET_POLICIES } from '../synchronization/policies.js';
import { qualifySessionSeries } from '../calendar/coverage.js';
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
  fetchedAt = new Date(),
): Promise<PreparedMarketPartition> {
  if (partition.dataset === 'index-weights') {
    return prepareIndexWeights(source, partition);
  }
  const definitions = {
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
  };
  const definition = definitions[partition.dataset as keyof typeof definitions];
  if (!definition) {
    throw new Error(`Unknown index dataset ${partition.dataset}`);
  }
  const baseline = DATASET_POLICIES.find(
    (policy) => policy.dataset === partition.dataset,
  )!.startDate;
  const discoverStart = partition.startDate === baseline;
  const sourceEnd = discoverStart
    ? [partition.endDate, localDate(fetchedAt)].sort().at(-1)!
    : partition.endDate;
  const pages = await fetchSourcePages(
    source,
    definition.api,
    { ts_code: partition.scope, start_date: partition.startDate, end_date: sourceEnd },
    Object.values(definition.columns).join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (
      row.ts_code !== partition.scope ||
      typeof row.trade_date !== 'string' ||
      !isObservationDate(row.trade_date) ||
      row.trade_date < partition.startDate ||
      row.trade_date > sourceEnd
    ) {
      throw new Error(`Invalid ${definition.api} identity/date`);
    }
    if (
      'close' in definition.columns &&
      (typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0)
    ) {
      throw new Error(`Invalid ${definition.api} close`);
    }

    return {
      values: sourceValues(row, definition.columns),
    };
  });

  const sourceStartDate =
    discoverStart && pages.complete && !mapped.errors.length
      ? mapped.records.map((record) => String(record.values.tradeDate)).sort()[0]
      : undefined;
  mapped.records = mapped.records.filter(
    (record) => String(record.values.tradeDate) <= partition.endDate,
  );
  const prepared = completeResponse({
    pages,
    table: definition.table,
    coverageComplete: true,
    replace: true,
    allowEmpty: true,
    ...mapped,
    observedDates: mapped.records.flatMap((record) =>
      typeof record.values.tradeDate === 'string' ? [record.values.tradeDate] : [],
    ),
  });

  if (sourceStartDate && sourceStartDate > partition.startDate) {
    prepared.sourceStartDate = sourceStartDate;
    if (sourceStartDate > partition.endDate) {
      prepared.status = 'not_applicable';
      prepared.tables[0].replace = false;
      return prepared;
    }
    return qualifySessionSeries({ ...partition, startDate: sourceStartDate }, prepared);
  }

  return qualifySessionSeries(partition, prepared);
}

/**
 * 完整业务操作独立于每日序列。
 *
 * This complete business operation is independent of daily series.
 */
async function prepareIndexWeights(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
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
    }));
    const codes = new Set(snapshot.records.map((record) => record.values.conCode));
    const sum = snapshot.records.reduce((total, record) => total + Number(record.values.weight), 0);

    if (
      !pages.complete ||
      snapshot.errors.length > 0 ||
      !isObservationDate(date) ||
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
    coverageComplete: true,
    allowEmpty: true,
    records,
    errors,
    observedDates: completeDates,
  });
  prepared.tables = completeDates.map((date) => ({
    table: 'IndexWeight',
    atomic: true,
    records: records.filter((record) => record.values.tradeDate === date),
    replace: true,
  }));

  return prepared;
}
