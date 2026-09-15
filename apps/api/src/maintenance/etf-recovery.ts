import { createHash } from 'node:crypto';
import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { ETF_RESEARCH_CODES } from '#market/registry/etf-research-registry.js';
import { syncEtfDaily } from '#market/sync/etf-history.js';
import { syncEtfMarketDate } from '#market/sync/etf.js';
import type { TushareClient } from '#market/providers/tushare/client.js';
import { completeMaintenanceItem, completedMaintenanceItems } from './state.js';

export interface EtfHistoryRange {
  tsCode: string;
  startDate: string;
  endDate: string;
}

/** Lifecycle bounds match the registry audit; historical share-size gaps remain explicit. */
export function planEtfHistory(
  products: Array<{ tsCode: string; listDate: string | null; delistDate: string | null }>,
  through: string,
): EtfHistoryRange[] {
  return products.flatMap((product) => {
    if (!product.listDate) {
      throw new Error(`ETF history requires a listing date for ${product.tsCode}`);
    }
    const startDate = product.listDate > '20150101' ? product.listDate : '20150101';
    const endDate =
      product.delistDate && product.delistDate < through ? product.delistDate : through;
    return startDate <= endDate ? [{ tsCode: product.tsCode, startDate, endDate }] : [];
  });
}

/** Weekly revisions use run-scoped checkpoints on top of atomic historical slices. */
export async function recoverEtfRegistry(
  client: TushareClient,
  runId: string,
  through: string,
  revisionDates: string[],
  onProgress: (completed: number, total: number) => Promise<void>,
): Promise<void> {
  const codes = [...ETF_RESEARCH_CODES].sort();
  const products = await prisma.etfBasic.findMany({
    where: { tsCode: { in: codes } },
    select: { tsCode: true, listDate: true, delistDate: true },
  });
  if (products.length !== codes.length) {
    throw new Error('ETF registry metadata is incomplete; refresh metadata before recovery');
  }
  const ranges = planEtfHistory(products, through);
  const stage = `etf-recovery-v1:${createHash('sha256').update(codes.join(',')).digest('hex')}`;
  const completed = await completedMaintenanceItems(runId, stage);
  let progress = 0;
  const total = ranges.length + revisionDates.length;
  for (const range of ranges) {
    const key = `history:${range.tsCode}:${range.startDate}:${range.endDate}`;
    if (!completed.has(key)) {
      // syncEtfDaily atomically checkpoints each validated code/year slice. A failed range
      // resumes its completed years rather than restarting the entire product history.
      await syncEtfDaily(
        client,
        [range.tsCode],
        range.startDate as TradeDate,
        range.endDate as TradeDate,
        { validateCoverage: true },
      );
      await completeMaintenanceItem(runId, stage, key);
    }
    await onProgress(++progress, total);
  }
  for (const date of revisionDates) {
    const key = `revision:${date}`;
    if (!completed.has(key)) {
      await syncEtfMarketDate(client, date as TradeDate, codes);
      await completeMaintenanceItem(runId, stage, key);
    }
    await onProgress(++progress, total);
  }
}
