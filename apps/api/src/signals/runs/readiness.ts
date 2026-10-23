import type { BacktestConfig } from '@jixie/shared';
import { datasetInputReadiness, type InputRequirement } from '#market/synchronization/readiness.js';
import { inspectStrategyMetadata } from '#strategy/sandbox/inspect-definition.js';
import { getDatabase } from '#infra/database/prisma.js';
import { isCompletedShanghaiDate } from '#market/calendar/sse-close.js';

/**
 * 根据市场发布水位与交易日历确定可用执行日。
 *
 * Resolve an eligible execution date from publication state and the market calendar.
 */
export async function resolveSignalExecutionDate(
  tradeDate: string,
): Promise<
  { kind: 'ready'; execDate: string } | { kind: 'invalid_date' } | { kind: 'next_date_missing' }
> {
  if (!/^\d{8}$/.test(tradeDate) || !isCompletedShanghaiDate(tradeDate)) {
    return { kind: 'invalid_date' };
  }
  const row = await getDatabase().tradeCal.findUnique({
    where: { exchange_calDate: { exchange: 'SSE', calDate: tradeDate } },
  });
  if (!row || row.isOpen !== 1) {
    return { kind: 'invalid_date' };
  }
  const next = await getDatabase().tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next ? { kind: 'ready', execDate: next.calDate } : { kind: 'next_date_missing' };
}

/**
 * 部署按自身资产和冻结历史需求判断，ETF 不依赖全市场估值截面。
 *
 * Evaluate a deployment's own assets and frozen history; ETF strategies do not depend on
 * whole-market valuations.
 */
export async function isSignalDataReady(
  tradeDate: string,
  config: BacktestConfig,
): Promise<boolean> {
  const metadata = await inspectStrategyMetadata(
    config.code,
    config.language === 'python' ? 'python' : 'typescript',
  );
  const etfs = await getDatabase().etfBasic.findMany({
    where: { tsCode: { in: metadata.watch } },
    select: { tsCode: true, listDate: true },
  });
  const etfCodes = new Set(etfs.map((etf) => etf.tsCode));
  const requirements: InputRequirement[] = [];
  if (!metadata.watch.length || metadata.watch.some((code) => !etfCodes.has(code))) {
    requirements.push(
      ...['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'].map(
        (dataset) => ({ dataset, scope: 'all', startDate: config.start, endDate: tradeDate }),
      ),
    );
  }
  for (const etf of etfs) {
    requirements.push(
      ...['etf-prices', 'etf-adjustments'].map((dataset) => ({
        dataset,
        scope: etf.tsCode,
        startDate: etf.listDate && etf.listDate > config.start ? etf.listDate : config.start,
        endDate: tradeDate,
      })),
    );
  }
  if (metadata.accounts && metadata.accounts.futures.cashWeight > 0) {
    const sessions = await getDatabase().tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: config.start, lte: tradeDate } },
      select: { calDate: true },
    });
    const inputs = await getDatabase().marketCalculationState.findMany({
      where: {
        kind: 'future-publication',
        status: 'ready',
        date: { gte: config.start, lte: tradeDate },
      },
    });
    if (
      sessions.some(
        (session) =>
          !inputs.some(
            (input) => input.date === session.calDate && input.generation === input.readyGeneration,
          ),
      )
    ) {
      return false;
    }
  }

  return (await datasetInputReadiness(requirements)).ready;
}
