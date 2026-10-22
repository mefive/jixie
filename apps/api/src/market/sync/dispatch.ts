import { parseSyncArguments } from './arguments.js';
import { runSyncTask as runStockPricesSync } from './stock-prices.js';
import { runSyncTask as runStockHistorySync } from './stock-history.js';
import { runSyncTask as runBasicSync } from './basic.js';
import { runSyncTask as runFinaSync } from './fina.js';
import { runSyncTask as runFuturesSync } from './futures.js';
import { runSyncTask as runCommodityFuturesSync } from './commodity-futures.js';
import { runSyncTask as runCommodityContinuousReturnsSync } from './commodity-continuous-returns.js';
import { runSyncTask as runCommodityHoldingsSync } from './commodity-holdings.js';
import { runSyncTask as runCommodityWarehouseReceiptsSync } from './commodity-warehouse-receipts.js';
import { runSyncTask as runEtfSync } from './etf.js';
import { runSyncTask as runIndexSync } from './index.js';
import { runSyncTask as runIndexDailySync } from './index-daily.js';
import { runSyncTask as runCrossMarketBenchmarksSync } from './cross-market-benchmarks.js';
import { runSyncTask as runIndexBasicSync } from './index-basic.js';
import { runSyncTask as runMarketStateSync } from './market-state.js';
import { runSyncTask as runMarketReferenceSync } from './market-reference.js';
import { runSyncTask as runRatesSync } from './rates.js';
import { runSyncTask as runCreditCurvesSync } from './credit-curves.js';
import { runSyncTask as runExternalMarketSync } from './external-market.js';
import { runSyncTask as runMacroSync } from './macro.js';
import { runSyncTask as runLimitSync } from './limit.js';
import { runSyncTask as runMoneyflowSync } from './moneyflow.js';
import { runSyncTask as runSwIndustrySync } from './sw-industry.js';
import { runSyncTask as runToplistSync } from './toplist.js';

const tasks: Record<string, (args: string[]) => Promise<void>> = {
  'stock-prices': runStockPricesSync,
  'stock-history': runStockHistorySync,
  basic: runBasicSync,
  fina: runFinaSync,
  futures: runFuturesSync,
  'commodity-futures': runCommodityFuturesSync,
  'commodity-continuous': runCommodityContinuousReturnsSync,
  'commodity-holdings': runCommodityHoldingsSync,
  'commodity-warehouse-receipts': runCommodityWarehouseReceiptsSync,
  etf: runEtfSync,
  index: runIndexSync,
  'index-daily': runIndexDailySync,
  'cross-market-benchmarks': runCrossMarketBenchmarksSync,
  'index-basic': runIndexBasicSync,
  'market-state': runMarketStateSync,
  'market-reference': runMarketReferenceSync,
  rates: runRatesSync,
  'credit-curves': runCreditCurvesSync,
  'external-market': runExternalMarketSync,
  macro: runMacroSync,
  limit: runLimitSync,
  moneyflow: runMoneyflowSync,
  'sw-industry': runSwIndustrySync,
  toplist: runToplistSync,
};

/** 同进程顺序调用同步任务，不改 argv 或关闭调用者连接。 / Invoke sync tasks in-process without changing argv or closing the caller's client. */
export async function executeMarketSync(args: string[]): Promise<void> {
  const request = parseSyncArguments(args);
  if (request.action !== 'run') {
    throw new Error('A market sync task is required');
  }

  await tasks[request.command.name](request.args);
}
