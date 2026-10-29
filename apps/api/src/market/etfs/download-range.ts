import { isObservationDate } from '../synchronization/date.js';

interface EtfLifecycle {
  listStatus: string;
  listDate: string | null;
  delistDate: string | null;
}

/**
 * 名单、调度和缺口摘要共用生命周期边界；退市日期未知时不猜测截止日。
 *
 * Share lifecycle bounds across lists, scheduling and gaps; never guess an unknown delisting date.
 */
export function etfDownloadRange(row: EtfLifecycle | undefined, baseline: string) {
  const startDate = row?.listDate ?? baseline;
  if (!row) {
    return { startDate, blockedReason: 'ETF catalog entry is missing' };
  }
  if (row.listStatus !== 'L' && row.listStatus !== 'D') {
    return { startDate, blockedReason: `ETF listing status ${row.listStatus} is not downloadable` };
  }
  if (row.listStatus === 'D' && !isObservationDate(row.delistDate)) {
    return { startDate, blockedReason: 'Delisted ETF has no valid delisting date' };
  }
  if (row.delistDate && (!isObservationDate(row.delistDate) || row.delistDate < startDate)) {
    return { startDate, blockedReason: 'ETF delisting date conflicts with its listing range' };
  }

  return { startDate, endDate: row.delistDate ?? undefined };
}
