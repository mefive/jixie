import type { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { prepareCalendarPartition } from './sync-partition.js';
import { writeCalendarPartition } from './write.js';

/**
 * 单范围日历入口与正式维护共用校验和写入。
 *
 * Single-range calendar synchronization uses the formal domain path.
 */
export async function syncTradeCal(
  client: TushareClient,
  start: string,
  end: string,
  exchange = 'SSE',
): Promise<number> {
  const partition = { dataset: 'calendar', scope: exchange, startDate: start, endDate: end };
  const prepared = await prepareCalendarPartition(client, partition);
  if (prepared.status !== 'complete') {
    throw new Error([...prepared.errors, ...prepared.gaps].join('; '));
  }
  await getDatabase().$transaction((transaction) =>
    writeCalendarPartition(transaction, prepared, partition),
  );

  return prepared.tables[0].records.length;
}
