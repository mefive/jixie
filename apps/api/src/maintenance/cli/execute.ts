import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { localDate } from '#market/synchronization/date.js';

/**
 * 执行路径才加载环境、数据库及外部来源；所有资源均在 finally 释放。
 *
 * Only execution loads environment, database and providers; finally releases owned resources.
 */
export async function executeDataSync(targetDate?: string): Promise<number> {
  const startedAt = new Date();
  const apiDirectory = new URL(
    import.meta.url.includes('/dist/') ? '../../../../' : '../../../',
    import.meta.url,
  );
  const envFile = new URL('.env', apiDirectory);
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
  const { prisma, withDatabase, closeDatabase } = await import('#infra/database/prisma.js');
  const { synchronizeData } = await import('../sync.js');
  const { TushareClient } = await import('#market/providers/tushare/tushare-client.js');
  const { loadTushareConfig } = await import('#market/providers/tushare/config.js');
  const { MinistryOfFinanceCurveClient } = await import('#market/rates/china-treasury-curve.js');
  const { ChinaBondPublicCurveClient } = await import('#market/rates/chinabond-credit-curves.js');
  const { BlsPublicDataClient } = await import('#market/macro/us-headline-cpi.js');
  const { MarketAccessBusyError } = await import('#infra/coordination/market-access.js');
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Synchronization interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const config = loadTushareConfig();
    const result = await withDatabase(prisma, () =>
      synchronizeData({
        targetDate: targetDate ?? localDate(startedAt),
        startedAt,
        signal: controller.signal,
        providers: {
          source: new TushareClient({
            ...config,
            minIntervalMs: Math.max(config.minIntervalMs, 800),
            maxRetries: 2,
          }),
          treasury: new MinistryOfFinanceCurveClient(),
          credit: new ChinaBondPublicCurveClient(),
          cpi: new BlsPublicDataClient(),
        },
      }),
    );
    console.log(JSON.stringify(result, null, 2));

    return result.status === 'error' ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof MarketAccessBusyError ? 75 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await closeDatabase(prisma);
  }
}
