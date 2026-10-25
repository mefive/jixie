import { getDatabase } from '#infra/database/prisma.js';
import { refreshFactorWeatherPin } from '#factor/weather/refresh.js';

/**
 * 后处理使用自身所有权和就绪检查，失败不回滚市场批次。
 *
 * Consumers own readiness and ownership; failures do not roll back data.
 */
export async function runSyncConsumers(
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
  if (signal?.aborted) {
    result.gaps.push('Consumer execution deferred by the run budget');
  }

  return result;
}
