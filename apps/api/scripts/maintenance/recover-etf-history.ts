import type { TradeDate } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { assertProductionLock } from '#maintenance/daily.js';
import { planEtfHistory } from '#maintenance/etf-recovery.js';
import { ETF_RESEARCH_CODES } from '#market/registry/etf-research-registry.js';
import { syncEtfBasic, syncEtfDaily } from '#market/sync/etf-history.js';
import { loadTushareConfig } from '#market/providers/tushare/config.js';
import { TushareClient } from '#market/providers/tushare/client.js';

/** Bootstrap owns the lock and has stopped the API before invoking this history backfill. */
async function main(): Promise<void> {
  assertProductionLock();
  const state = await prisma.maintenanceState.findUnique({ where: { key: 'global' } });
  if (!state?.dailyPublishedThrough) {
    console.log('ETF history recovery awaits the initial validated daily baseline');
    return;
  }
  const client = new TushareClient(loadTushareConfig());
  await syncEtfBasic(client);
  const products = await prisma.etfBasic.findMany({
    where: { tsCode: { in: [...ETF_RESEARCH_CODES] } },
    select: { tsCode: true, listDate: true, delistDate: true },
  });
  if (products.length !== ETF_RESEARCH_CODES.length) {
    throw new Error('ETF registry metadata is incomplete');
  }
  for (const range of planEtfHistory(products, state.dailyPublishedThrough)) {
    await syncEtfDaily(
      client,
      [range.tsCode],
      range.startDate as TradeDate,
      range.endDate as TradeDate,
      { validateCoverage: true },
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error('ETF history recovery failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
