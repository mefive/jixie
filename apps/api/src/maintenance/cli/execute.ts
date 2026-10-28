import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { DataRequest } from './data.js';
import { localDate } from '#market/synchronization/date.js';

/**
 * 执行路径才加载环境、数据库及外部来源；所有资源均在 finally 释放。
 *
 * Only execution loads environment, database and providers; finally releases owned resources.
 */
export async function executeDataCommand(
  request: Exclude<DataRequest, { action: 'help' }>,
): Promise<number> {
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
  const { MarketAccessBusyError } = await import('#infra/coordination/market-access.js');
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Synchronization interrupted'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await withDatabase(prisma, async () => {
      const { listDownloads, changeDownloadList } = await import('#market/downloads/lists.js');
      switch (request.action) {
        case 'list':
          return listDownloads(request.assetType);
        case 'add':
        case 'remove':
          return changeDownloadList(request.assetType, request.action, request.code);
        default:
          break;
      }

      const config = loadTushareConfig();
      const source = new TushareClient({
        ...config,
        minIntervalMs: Math.max(config.minIntervalMs, 800),
        maxRetries: 2,
      });
      if (request.action === 'select-top') {
        const { selectTopEtfs } = await import('#market/downloads/select-etfs.js');
        const { withSourceRequestBudget } = await import('#market/providers/source-fetch.js');
        return withSourceRequestBudget(
          { remaining: 600, deadline: Date.now() + 30 * 60_000, signal: controller.signal },
          () => selectTopEtfs({ source, limit: request.limit }),
        );
      }

      return synchronizeData({
        targetDate: request.targetDate ?? localDate(startedAt),
        startedAt,
        signal: controller.signal,
        providers: { source },
      });
    });
    console.log(JSON.stringify(result, null, 2));

    return result && !Array.isArray(result) && 'status' in result && result.status === 'error'
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof MarketAccessBusyError ? 75 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await closeDatabase(prisma);
  }
}
