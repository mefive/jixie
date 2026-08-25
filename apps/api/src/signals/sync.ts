import type { TradeDate } from '@jixie/shared';
import { loadTushareConfig } from '../config.js';
import { inspectWalledStrategyMetadata } from '../engine/walled-run.js';
import { prisma } from '../lib/prisma.js';
import {
  MinistryOfFinanceCurveClient,
  syncChinaTreasuryYieldCurve,
} from '../rates/china-treasury-curve.js';
import { governmentYieldTermsFromDependencies } from '../rates/signal-readiness.js';
import {
  syncDaily,
  syncDailyBasic,
  syncMoneyflow,
  syncStkLimit,
  syncTopList,
  syncTradeCal,
} from '../store/sync.js';
import { syncEtfMarketDate } from '../store/etf-market-sync.js';
import { ETF_RESEARCH_CODES } from '../store/etf-research-registry.js';
import { TushareClient } from '../tushare/client.js';
import { factorDependenciesFromJson } from './factor-dependency-lineage.js';

/** Synchronize the datasets needed by active stock/ETF deployments for one signal close. */
export async function syncSignalMarketData(
  tradeDate: string,
  onLog: (line: string) => void = console.log,
  options: {
    coreAlreadyPublished?: boolean;
    extensionsAlreadyPublished?: boolean;
    refresh?: boolean;
  } = {},
): Promise<void> {
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });
  const deployments = await prisma.strategyDeployment.findMany({
    where: { status: 'active' },
    select: { config: true, factorDependencies: true },
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
  if (!options.coreAlreadyPublished) {
    await syncTradeCal(client, tradeDate, addCalendarDays(tradeDate, 14));
  }
  const calendar = await prisma.tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
    select: { isOpen: true },
  });
  if (!calendar || calendar.isOpen !== 1) {
    onLog(`${tradeDate} is not an open trading day; no market data sync needed`);
    return;
  }

  if (!options.coreAlreadyPublished) {
    await syncDaily(client, tradeDate, tradeDate);
    await syncDailyBasic(client, tradeDate, tradeDate);
    await syncStkLimit(client, tradeDate, tradeDate);
  }

  const factorDependencies = deployments.flatMap(
    (deployment) => factorDependenciesFromJson(deployment.factorDependencies) ?? [],
  );
  const yieldTerms = governmentYieldTermsFromDependencies(factorDependencies);
  if (yieldTerms.length > 0) {
    onLog(`Syncing government yield curve for active maturities ${yieldTerms.join(', ')}Y`);
    await syncChinaTreasuryYieldCurve(
      new MinistryOfFinanceCurveClient(),
      addCalendarDays(tradeDate, -21),
      tradeDate,
      onLog,
    );
  }

  const factorKeys = definitions.flatMap((definition) => definition.factors);
  const sourceCode = deployments
    .map((deployment) => (deployment.config as { code?: unknown }).code)
    .filter((code): code is string => typeof code === 'string')
    .join('\n');
  if (
    !options.extensionsAlreadyPublished &&
    (factorKeys.some((key) => key.startsWith('mf_')) || sourceCode.includes('netMain'))
  ) {
    await syncMoneyflow(client, tradeDate, tradeDate, { refresh: options.refresh });
  }
  if (!options.extensionsAlreadyPublished && sourceCode.includes('.lhbNet(')) {
    await syncTopList(client, tradeDate, tradeDate, { refresh: options.refresh });
  }

  const watchedCodes = [...new Set(definitions.flatMap((definition) => definition.watch))];
  const watchedEtfs = await prisma.etfBasic.findMany({
    where: { tsCode: { in: watchedCodes } },
    select: { tsCode: true },
  });
  const etfCodes = [...new Set([...ETF_RESEARCH_CODES, ...watchedEtfs.map((etf) => etf.tsCode)])];
  onLog(
    `Syncing ${ETF_RESEARCH_CODES.length} registry ETF products plus ${watchedEtfs.length} deployment reference(s)`,
  );
  await syncEtfMarketDate(client, tradeDate as TradeDate, etfCodes);
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
