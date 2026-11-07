import { isObservationDate } from '../synchronization/date.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourceRange,
  mapSourceRecords,
  sourceString,
  sourceValues,
  type SyncSource,
} from '../synchronization/source.js';

/**
 * 只接纳来源实际提供的日历；历史缺失不补造、不报错。
 *
 * Admit only provided calendar rows; missing history is never fabricated or treated as an error.
 */
export async function prepareCalendarPartition(
  source: SyncSource,
  partition: MarketPartition,
): Promise<PreparedMarketPartition> {
  const columns = {
    exchange: 'exchange',
    calDate: 'cal_date',
    isOpen: 'is_open',
    pretradeDate: 'pretrade_date',
  };
  const pages = await fetchSourceRange(
    source,
    'trade_cal',
    { exchange: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(columns).join(','),
    partition.adaptiveRange,
  );
  const mapped = mapSourceRecords(pages.rows, (row) => {
    const date = sourceString(row, 'cal_date');
    if (
      row.exchange !== partition.scope ||
      !isObservationDate(date) ||
      date < partition.startDate ||
      date > partition.endDate ||
      ![0, 1].includes(Number(row.is_open))
    ) {
      throw new Error('Invalid exchange calendar row');
    }

    return { values: sourceValues(row, columns) };
  });
  const dates = new Set(mapped.records.map((record) => String(record.values.calDate)));
  const prepared = completeResponse({
    pages,
    table: 'TradeCal',
    replace: false,
    allowEmpty: true,
    ...mapped,
    observedDates: [...dates],
  });

  return prepared;
}
