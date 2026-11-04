import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataRequest } from './data.js';
import { localDate } from '#market/synchronization/date.js';

/**
 * 只有有效执行请求才打开环境与数据库，所有分支均释放连接。
 *
 * Only valid execution requests open configuration and database; every branch releases resources.
 */
export async function executeDataCommand(
  request: Exclude<DataRequest, { action: 'help' }>,
): Promise<number> {
  const apiDirectory = new URL(
    import.meta.url.includes('/dist/') ? '../../../../' : '../../../',
    import.meta.url,
  );
  const envFile = new URL('.env', apiDirectory);
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
  const { prisma, createDatabase, withDatabase, closeDatabase } =
    await import('#infra/database/prisma.js');
  const { databaseFilename, MarketAccessBusyError } =
    await import('#infra/coordination/market-access.js');
  const database =
    request.action === 'reset' && request.database
      ? createDatabase(`file:${request.database}`)
      : prisma;
  if (request.action === 'reset' && request.database) {
    process.env.DATABASE_URL = `file:${request.database}`;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await withDatabase(database, async () => {
      const { listDownloads, changeDownloadList } = await import('#market/downloads/lists.js');
      switch (request.action) {
        case 'list':
          return listDownloads(request.assetType);
        case 'add':
        case 'remove':
          return changeDownloadList(request.assetType, request.action, request.code);
        case 'runs':
          return database.ingestionRun.findMany({
            select: { id: true, status: true, startedAt: true, finishedAt: true },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: request.limit,
          });
        case 'reconcile-issues': {
          const { reconcileIssueResolutions } = await import('../resolutions.js');

          return reconcileIssueResolutions(request.runId);
        }
        case 'export-issues': {
          const { exportIngestionIssues } = await import('../issue-export.js');
          const { diagnosticCodeIdentity, writeIssueExportFile } =
            await import('./issue-export-file.js');
          const project = fileURLToPath(new URL('../../', apiDirectory));
          const code = await diagnosticCodeIdentity(project);
          const bundle = await exportIngestionIssues({
            runId: request.runId,
            issueId: request.issueId,
            code,
          });
          controller.signal.throwIfAborted();
          const output = await writeIssueExportFile(request.output, bundle, databaseFilename());

          return { output, counts: bundle.counts, limitations: bundle.limitations };
        }
        case 'issues':
          return database.ingestionIssue.findMany({
            where: { runId: request.runId },
            include: {
              resolution: true,
              batch: {
                select: {
                  dataset: true,
                  scope: true,
                  period: true,
                  api: true,
                  request: true,
                  rangeStart: true,
                  rangeEnd: true,
                  responseComplete: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          });
        case 'reset': {
          const { resetBusinessData } = await import('../reset.js');
          const filename = databaseFilename();

          return resetBusinessData({
            apply: request.apply,
            backup: async () => {
              const backupDirectory = join(dirname(filename), 'ingestion-backups');
              await promisify(execFile)(
                process.execPath,
                [fileURLToPath(new URL('scripts/backup-db.mjs', apiDirectory))],
                {
                  env: {
                    ...process.env,
                    JIXIE_DB_PATH: filename,
                    JIXIE_BACKUP_DIR: backupDirectory,
                  },
                  maxBuffer: 1024 * 1024,
                },
              );

              return backupDirectory;
            },
          });
        }
        default:
          break;
      }
      const { TushareClient } = await import('#market/providers/tushare/tushare-client.js');
      const { loadTushareConfig } = await import('#market/providers/tushare/config.js');
      const config = loadTushareConfig();
      const source = new TushareClient({
        ...config,
        minIntervalMs: Math.max(800, config.minIntervalMs),
        maxRetries: 2,
      });
      if (request.action === 'select-top') {
        const { selectTopEtfs } = await import('#market/downloads/select-etfs.js');

        return selectTopEtfs({ source, limit: request.limit });
      }
      const { ingest } = await import('../ingest.js');

      return ingest({
        targetDate: request.targetDate ?? localDate(new Date()),
        source,
        signal: controller.signal,
        trigger: process.env.JIXIE_INGESTION_TRIGGER === 'timer' ? 'timer' : 'manual',
      });
    });
    console.log(JSON.stringify(result, null, 2));

    return result && !Array.isArray(result) && 'status' in result && result.status !== 'completed'
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return error instanceof MarketAccessBusyError ? 75 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await closeDatabase(database);
  }
}
