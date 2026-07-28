import { loadTushareConfig } from '../config.js';
import { inspectWalledStrategyMetadata } from '../engine/walled-run.js';
import { prisma } from '../lib/prisma.js';
import {
  syncDaily,
  syncDailyBasic,
  syncEtfBasic,
  syncEtfDaily,
  syncMoneyflow,
  syncStkLimit,
  syncTopList,
  syncTradeCal,
} from '../store/sync.js';
import { TushareClient } from '../tushare/client.js';

/** Synchronize the datasets needed by active stock/ETF deployments for one signal close. */
export async function syncSignalMarketData(
  tradeDate: string,
  onLog: (line: string) => void = console.log,
): Promise<void> {
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const deployments = await prisma.strategyDeployment.findMany({
    where: { status: 'active' },
    select: { config: true },
  });
  const definitions = await Promise.all(
    deployments.map(async (deployment) => {
      const strategyConfig = deployment.config as { code?: unknown };
      return typeof strategyConfig.code === 'string'
        ? inspectWalledStrategyMetadata(strategyConfig.code)
        : { watch: [], futures: [], factors: [] };
    }),
  );

  onLog(`Syncing signal data for ${tradeDate}`);
  await syncTradeCal(client, tradeDate, addCalendarDays(tradeDate, 14));
  const calendar = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
    select: { isOpen: true },
  });
  if (!calendar || calendar.isOpen !== 1) {
    onLog(`${tradeDate} is not an open trading day; no market data sync needed`);
    return;
  }

  await syncDaily(client, tradeDate, tradeDate);
  await syncDailyBasic(client, tradeDate, tradeDate);
  await syncStkLimit(client, tradeDate, tradeDate);

  const factorKeys = definitions.flatMap((definition) => definition.factors);
  const sourceCode = deployments
    .map((deployment) => (deployment.config as { code?: unknown }).code)
    .filter((code): code is string => typeof code === 'string')
    .join('\n');
  if (factorKeys.some((key) => key.startsWith('mf_')) || sourceCode.includes('netMain')) {
    await syncMoneyflow(client, tradeDate, tradeDate);
  }
  if (sourceCode.includes('.lhbNet(')) {
    await syncTopList(client, tradeDate, tradeDate);
  }

  const watchedCodes = [...new Set(definitions.flatMap((definition) => definition.watch))];
  if (watchedCodes.length > 0) {
    await syncEtfBasic(client);
    const etfs = await prisma.etfBasic.findMany({
      where: { tsCode: { in: watchedCodes } },
      select: { tsCode: true },
    });
    if (etfs.length > 0) {
      await syncEtfDaily(
        client,
        etfs.map((etf) => etf.tsCode),
        tradeDate,
        tradeDate,
        { refresh: true },
      );
    }
  }
  onLog(`Signal data sync complete for ${tradeDate}`);
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)) + days,
    ),
  );
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}
