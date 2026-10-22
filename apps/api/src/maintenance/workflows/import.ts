import { getStagingContext } from '#infra/coordination/staging-input.js';
import { executeMarketSync } from '#market/sync/dispatch.js';
import { getDatabase } from '#infra/database/prisma.js';
import { canonicalizeStockCodes } from '#market/instruments/canonicalize-stock-codes.js';
import { getRecentOpenDates } from '#market/calendar/read.js';
import { runRepairMaintenance } from './repair.js';
import { runDailyMaintenance } from './daily.js';

/**
 * 在单个候选中执行可恢复导入；完成标记随候选库保存，正式库只接受一次发布。
 *
 * Run restartable imports within one candidate; checkpoints stay with that candidate until one publication.
 */
export async function importMarketData(args: string[]): Promise<void> {
  const [start, end] = args;
  if (args.length !== 2 || !/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
    throw new Error('Usage: maintenance import START END');
  }
  const context = getStagingContext();
  if (!context) {
    throw new Error('Import requires a candidate execution scope');
  }
  const runId = context.id;
  const completed = new Set(
    (await getDatabase().maintenanceCheckpoint.findMany({ where: { runId, stage: 'import' } })).map(
      (row) => row.itemKey,
    ),
  );
  const stage = async (key: string, operation: () => Promise<unknown>) => {
    if (completed.has(key)) {
      return;
    }
    await context.reportProgress?.('importing', { currentStage: key });
    await operation();
    await getDatabase().maintenanceCheckpoint.upsert({
      where: { runId_stage_itemKey: { runId, stage: 'import', itemKey: key } },
      create: { runId, stage: 'import', itemKey: key },
      update: { completedAt: new Date() },
    });
  };
  const sync = async (key: string, ...parameters: string[]) =>
    stage(key, () => executeMarketSync(parameters));
  await sync('stock-history', 'stock-history', '19900101', end);
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    const first = start > `${year}0101` ? start : `${year}0101`;
    const last = end < `${year}1231` ? end : `${year}1231`;
    for (const task of ['stock-prices', 'basic', 'limit', 'moneyflow', 'toplist']) {
      await sync(`${task}:${year}`, task, first, last);
    }
  }
  await sync('financials', 'fina');
  await sync('industry', 'sw-industry');
  await sync('etf', 'etf', start, end, 'major');
  await sync('index-daily', 'index-daily', '19900101', end, 'major');
  await sync('index-basic', 'index-basic', '20040101', end, 'major');
  await sync('index-membership', 'index', 'market-state', start, end);
  await sync('market-reference', 'market-reference', start, end);
  await sync('treasury', 'rates', '20060301', end);
  await sync('futures', 'futures', start, end);
  await sync('commodity-etf', 'etf', '20191201', end, '159985.SZ,159980.SZ,159981.SZ', 'refresh');
  await sync(
    'cross-market-etf',
    'etf',
    '20120501',
    end,
    '510300.SH,159920.SZ,513500.SH',
    'refresh',
  );
  await sync('macro', 'macro', '200501', end.slice(0, 6));
  await sync('external-market', 'external-market', '20050101', end);
  await sync('credit-curves', 'credit-curves', '20060101', end);
  await sync('cross-market-benchmarks', 'cross-market-benchmarks', '20050101', end);
  await sync('commodity-futures', 'commodity-futures', '20150105', end);
  await sync('commodity-holdings', 'commodity-holdings', '20150105', end);
  await sync('commodity-continuous', 'commodity-continuous', '20150105', end);
  await sync('warehouse-receipts', 'commodity-warehouse-receipts', '20150101', end);
  await stage('canonicalize', () => canonicalizeStockCodes());
  await stage('repair', async () => {
    const dates = await getRecentOpenDates(end, 20);
    if (!dates[0]) {
      throw new Error('Imported calendar has no completed repair dates');
    }
    await runRepairMaintenance({ startDate: dates[0], endDate: end, deferPublication: true });
  });
  await stage('initialize', () =>
    runDailyMaintenance({ initializeOnly: true, deferPublication: true }),
  );
}
