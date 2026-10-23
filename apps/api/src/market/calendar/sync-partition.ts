import { calendarDay, isObservationDate } from '../synchronization/date.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';
import {
  completeResponse,
  fetchSourcePages,
  mapSourceRecords,
  sourceString,
  sourceValues,
  type SyncSource,
} from '../synchronization/source.js';

/**
 * 日历必须覆盖每个自然日；有限前瞻仅供可得日/执行日定位。
 *
 * Calendars must cover every calendar day; bounded lookahead only resolves availability and
 * execution.
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
  const pages = await fetchSourcePages(
    source,
    'trade_cal',
    { exchange: partition.scope, start_date: partition.startDate, end_date: partition.endDate },
    Object.values(columns).join(','),
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

    return { values: sourceValues(row, columns), availabilityQuality: 'source_contract' };
  });
  const dates = new Set(mapped.records.map((record) => String(record.values.calDate)));
  for (let date = partition.startDate; date <= partition.endDate; date = calendarDay(date, 1)) {
    if (!dates.has(date)) {
      mapped.errors.push(`Missing ${partition.scope} calendar date ${date}`);
    }
  }

  return completeResponse({
    pages,
    table: 'TradeCal',
    extent: {
      basis: 'Every requested calendar day is present',
      deletion: 'Validated exact calendar dates',
    },
    ...mapped,
    where: {
      exchange: partition.scope,
      calDate: { gte: partition.startDate, lte: partition.endDate },
    },
    observedDates: [...dates],
  });
}
