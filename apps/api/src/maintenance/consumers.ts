import { getDatabase } from '#infra/database/prisma.js';
import { inspectStrategyMetadata } from '#strategy/sandbox/inspect-definition.js';
import { refreshFactorWeatherPin } from '#factor/weather/refresh.js';
import { generateDailySignals } from '#signals/daily/scheduler.js';
import { latestCompletedTradeDate } from '#market/calendar/sse-close.js';
import { withMarketAccess } from '#infra/coordination/market-access.js';
import type { SyncRequirements } from './partitions.js';

/**
 * 活跃部署仅贡献数据需求，Market 不回调策略或用户配置。
 *
 * Active deployments contribute requirements; Market never calls strategies or user configuration.
 */
export async function loadSyncRequirements(): Promise<SyncRequirements> {
  const deployments = await getDatabase().strategyDeployment.findMany({
    where: { status: 'active' },
    select: { config: true },
  });
  const watched = new Set<string>();
  for (const deployment of deployments) {
    const config = deployment.config;
    if (
      config &&
      !Array.isArray(config) &&
      typeof config === 'object' &&
      typeof config.code === 'string'
    ) {
      try {
        const metadata = await inspectStrategyMetadata(
          config.code,
          config.language === 'python' ? 'python' : 'typescript',
        );
        for (const code of metadata.watch) {
          watched.add(code);
        }
      } catch (error) {
        console.warn('[data sync] Deployment requirements unavailable', error);
      }
    }
  }
  return { etfCodes: [...watched] };
}

/**
 * 后处理使用自身所有权和就绪检查，失败不回滚市场批次或重做已执行信号。
 *
 * Consumers own readiness and ownership; failures neither roll back data nor redo executed signals.
 */
export async function runSyncConsumers(
  targetDate: string,
  signal?: AbortSignal,
): Promise<{ gaps: string[]; errors: string[] }> {
  const result = { gaps: [] as string[], errors: [] as string[] };
  if (signal?.aborted) {
    result.gaps.push('Consumer execution deferred by the run budget');
    return result;
  }
  const pins = await getDatabase().factorWeatherPin.findMany({
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });
  for (const pin of pins.slice(0, 20)) {
    if (signal?.aborted) {
      result.gaps.push('Consumer execution budget exhausted');
      break;
    }
    try {
      const refreshed = await refreshFactorWeatherPin(pin.id, { signal });
      if (refreshed.skipped && !refreshed.computedThrough) {
        result.gaps.push(`Factor weather ${pin.id}: waiting for eligible completed periods`);
      }
    } catch (error) {
      (signal?.aborted ? result.gaps : result.errors).push(
        `Factor weather ${pin.id}: ${String(error)}`,
      );
    }
  }
  const latest = await withMarketAccess(latestCompletedTradeDate);
  // 较早目标只修订数据，不自动补发历史信号或改写后续账户。
  // An earlier target revises data without automatically issuing historical signals or rewriting later accounts.
  if (latest && latest <= targetDate && !signal?.aborted) {
    try {
      const signals = await generateDailySignals(latest, console.log, signal);
      result.gaps.push(...signals.accounts.gaps);
      result.errors.push(...signals.accounts.failures);
      if (signals.waiting) {
        result.gaps.push(`${signals.waiting} signal consumers waiting for their own inputs`);
      }
      if (signals.errors) {
        result.errors.push(`${signals.errors} signal consumer failures`);
      }
    } catch (error) {
      (signal?.aborted ? result.gaps : result.errors).push(`Signals: ${String(error)}`);
    }
  }

  if (signal?.aborted) {
    result.gaps.push('Consumer execution deferred by the run budget');
  }

  return result;
}
