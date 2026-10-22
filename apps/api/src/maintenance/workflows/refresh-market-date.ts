import type { TradeDate } from '@jixie/shared';
import type { PreparedEtfMarketDate } from '#market/etfs/sync.js';
import { syncIndexDaily, syncIndexDailyBasic, syncSwIndexDaily } from '#market/indices/sync.js';
import type { TushareClient } from '#market/providers/tushare/tushare-client.js';
import {
  DAILY_MAINTAINED_INDEX_CODES,
  MAJOR_INDEX_DAILY_BASIC_CODES,
} from '#market/registry/index-presets.js';
import { syncStockDailyData } from '#market/stocks/daily-sync.js';
import { syncMoneyflow, syncTopList } from '#market/stocks/flows-sync.js';
import { syncSignalMarketData } from '#signals/daily/sync.js';
import { validateRawMarketDate } from '../publication/gate.js';

interface MarketDateRefreshOptions {
  preparedEtf: PreparedEtfMarketDate;
  treasuryAlreadyPrepared?: boolean;
  onLog: (line: string) => void;
  onStage: (stage: string) => Promise<void>;
}

/**
 * 日更和人工修复共用单日刷新顺序；运行记录、计算与发布由调用方负责。
 *
 * Share daily refresh ordering between daily and repair; callers own runs, computation and publication.
 */
export async function refreshMarketDate(
  client: TushareClient,
  tradeDate: TradeDate,
  options: MarketDateRefreshOptions,
) {
  await options.onStage('syncing_raw');
  options.onLog(`Fetching validated candidates for ${tradeDate}`);
  const core = await syncStockDailyData(client, tradeDate);
  await syncMoneyflow(client, tradeDate, tradeDate, { refresh: true });
  await syncTopList(client, tradeDate, tradeDate, { refresh: true });

  await options.onStage('syncing_indices');
  for (const indexCode of DAILY_MAINTAINED_INDEX_CODES) {
    await syncIndexDaily(client, indexCode, tradeDate, tradeDate);
  }
  await syncSwIndexDaily(client, tradeDate, tradeDate);
  await syncIndexDailyBasic(client, [...MAJOR_INDEX_DAILY_BASIC_CODES], tradeDate, tradeDate);
  await syncSignalMarketData(tradeDate, options.onLog, {
    coreAlreadyPublished: true,
    extensionsAlreadyPublished: true,
    treasuryAlreadyPublished: options.treasuryAlreadyPrepared,
    refresh: true,
    preparedEtf: options.preparedEtf,
  });

  await options.onStage('validating_raw');
  const quality = await validateRawMarketDate(tradeDate);

  return { core, quality };
}
