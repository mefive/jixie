import { prisma } from '#infra/database/prisma.js';
import { syncCommodityFutureContracts, syncCommodityFutureDaily } from '../futures/sync.js';
import type { TushareClient } from '../providers/tushare/client.js';
import {
  syncCommodityHoldingPositions,
  type CommodityHoldingSyncSummary,
} from './commodity-holding-positions.js';

export async function refreshCommodityHoldingPositions(
  client: TushareClient,
  startDate: string,
  endDate: string,
  onLog: (line: string) => void,
): Promise<CommodityHoldingSyncSummary> {
  await syncCommodityFutureContracts(client);
  await syncCommodityFutureDaily(client, startDate, endDate);
  return syncCommodityHoldingPositions(client, startDate, endDate, prisma, onLog);
}
