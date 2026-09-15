import { createHash } from 'node:crypto';
import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { ETF_RESEARCH_CODES } from '#market/registry/etf-research-registry.js';
import {
  ETF_HISTORY_START,
  inspectEtfHistoryCoverage,
} from '#market/quality/etf-history-coverage.js';
import { fillEtfHistoryGap, syncEtfMarketDate } from '#market/sync/etf.js';
import type { TushareClient } from '#market/providers/tushare/client.js';
import { completeMaintenanceItem, completedMaintenanceItems } from './state.js';

/** Reinspect the entire history on every attempt; rows, not old markers, prove coverage. */
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
    orderBy: { tsCode: 'asc' },
  });
  if (products.length !== codes.length || products.some((product) => !product.listDate)) {
    throw new Error('ETF registry metadata is incomplete; refresh metadata before recovery');
  }
  const calendar = await prisma.tradeCal.findMany({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gte: ETF_HISTORY_START, lte: through } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  if (!calendar.length || calendar.at(-1)!.calDate !== through) {
    throw new Error(`ETF history calendar does not reach publication waterline ${through}`);
  }
  const stage = `etf-recovery-v2:${createHash('sha256').update(JSON.stringify({ products, through })).digest('hex')}`;
  const completed = await completedMaintenanceItems(runId, stage);
  let progress = 0;
  const total = calendar.length + revisionDates.length;
  // Bound memory and queries to one year, but inspect all dates and all three datasets.
  for (const year of new Set(calendar.map((row) => row.calDate.slice(0, 4)))) {
    const dates = calendar.filter((row) => row.calDate.startsWith(year)).map((row) => row.calDate);
    const gaps = await inspectEtfHistoryCoverage(prisma, products, dates);
    for (const gap of gaps) {
      // Cache only explicitly observed source absences within this run. A new weekly retries
      // these observations; no annual completion marker can conceal a newly deleted row.
      gap.daily = gap.daily.filter((code) => !completed.has(`no-daily:${gap.tradeDate}:${code}`));
      gap.shareSize = gap.shareSize.filter(
        (code) => !completed.has(`no-share:${gap.tradeDate}:${code}`),
      );
      if (gap.daily.length || gap.adjustment.length || gap.shareSize.length) {
        const result = await fillEtfHistoryGap(client, gap);
        for (const code of result.missingDailyCodes) {
          const key = `no-daily:${gap.tradeDate}:${code}`;
          await completeMaintenanceItem(runId, stage, key);
          completed.add(key);
        }
        for (const code of result.missingShareSizeCodes) {
          const key = `no-share:${gap.tradeDate}:${code}`;
          await completeMaintenanceItem(runId, stage, key);
          completed.add(key);
        }
      }
      await onProgress(++progress, total);
    }
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
