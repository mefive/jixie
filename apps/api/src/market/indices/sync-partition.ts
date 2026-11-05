import { recordImportIssue } from '../synchronization/diagnostics.js';
import { preferStockSources } from '../instruments/source-selection.js';
import { calendarDay, isObservationDate } from '../synchronization/date.js';
import { getDatabase } from '#infra/database/prisma.js';
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
  const pages = await fetchSourcePages(
    source,
    definition.api,
    {
      ts_code: partition.scope,
      ...(partition.fullHistory ? {} : { start_date: partition.startDate }),
      end_date: partition.endDate,
    },
    Object.values(definition.columns).join(','),
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    if (
      row.ts_code !== partition.scope ||
      typeof row.trade_date !== 'string' ||
      !isObservationDate(row.trade_date) ||
      row.trade_date < partition.startDate ||
      row.trade_date > partition.endDate
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

  const prepared = completeResponse({
    pages,
    table: definition.table,
    replace: true,
    allowEmpty: true,
    ...mapped,
    observedDates: mapped.records.flatMap((record) =>
      typeof record.values.tradeDate === 'string' ? [record.values.tradeDate] : [],
    ),
  });

  if (partition.fullHistory && pages.complete && !mapped.errors.length) {
    prepared.sourceStartDate = mapped.records
      .map((record) => String(record.values.tradeDate))
      .sort()[0];
  }

  return prepared;
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
  if (
    !isObservationDate(partition.startDate) ||
    !isObservationDate(partition.endDate) ||
    partition.startDate > partition.endDate ||
    partition.startDate.slice(0, 6) !== partition.endDate.slice(0, 6)
  ) {
    throw new Error('Index weights require a valid monthly window');
  }
  const calendar = await getDatabase().tradeCal.findMany({
    where: {
      exchange: 'SSE',
      calDate: { gte: partition.startDate, lte: partition.endDate },
    },
    orderBy: { calDate: 'desc' },
    select: { calDate: true, isOpen: true },
  });
  let expectedDays = 0;
  for (let date = partition.startDate; date <= partition.endDate; date = calendarDay(date, 1)) {
    expectedDays++;
  }
  if (!expectedDays || calendar.length !== expectedDays) {
    throw new Error('Index weights require a complete verified SSE calendar window');
  }

  // 月度来源按明确交易日查询；未结束月份只查询目标范围内的日期。
  // Query monthly source snapshots by an explicit session within the fixed target window.
  const tradeDate = calendar.find((day) => day.isOpen === 1)?.calDate ?? partition.endDate;
  const pages = await fetchSourcePages(
    source,
    'index_weight',
    { index_code: partition.scope, trade_date: tradeDate },
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

  for (const [date, candidates] of groups) {
    const rows = preferStockSources(
      candidates,
      (row) => `${row.index_code}/${canonicalStockCode(String(row.con_code))}/${row.trade_date}`,
      (row) => String(row.con_code),
    );
    const snapshot = mapSourceRecords(rows, (row) => ({
      values: {
        indexCode: sourceString(row, 'index_code'),
        conCode: canonicalStockCode(sourceString(row, 'con_code')),
        sourceTsCode: sourceString(row, 'con_code'),
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
      date !== tradeDate ||
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
      const message = `Incomplete or invalid constituent snapshot ${partition.scope}/${date}`;
      errors.push(message);
      recordImportIssue({
        category: 'snapshot',
        reasonCode: 'snapshot_not_accepted',
        message,
        businessKey: { index: partition.scope, date },
        payload: candidates,
      });
      continue;
    }

    completeDates.push(date);
    records.push(...snapshot.records);
  }

  const prepared = completeResponse({
    pages,
    table: 'IndexWeight',
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
