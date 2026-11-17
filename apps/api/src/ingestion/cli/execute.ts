import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
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
  const { prisma, createDatabase, withDatabase, closeDatabase, usesMarketVersions } =
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
  let client: import('#market/providers/tushare/tushare-client.js').TushareClient | undefined;
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await withDatabase(database, async () => {
      const { listDownloads, changeDownloadList } = await import('#market/downloads/lists.js');
      const { getMarketDatabase } = await import('#infra/database/market-database.js');
      const { marketVersionFile } = await import('#infra/database/filename.js');
      const { withMarketAccess } = await import('#infra/coordination/market-access.js');
      const readRun = async <Result>(
        runId: string,
        read: (
          connection: ReturnType<typeof getMarketDatabase>,
          dataLocation: 'candidate' | 'published',
        ) => Promise<Result>,
      ) => {
        if (usesMarketVersions()) {
          const { withVersionEvidence } = await import('../version-lifecycle.js');
          return withVersionEvidence(runId, (location) => read(getMarketDatabase(), location));
        }
        const run = await database.ingestionRun.findUnique({ where: { id: runId } });
        if (run?.activeReplica) {
          const { withCandidate } = await import('../replica-files.js');

          return withCandidate(runId, () => read(getMarketDatabase(), 'candidate'));
        }

        return read(getMarketDatabase(), 'published');
      };
      switch (request.action) {
        case 'list':
          return usesMarketVersions()
            ? withMarketAccess(() => listDownloads(request.assetType))
            : listDownloads(request.assetType);
        case 'add':
        case 'remove':
          return changeDownloadList(request.assetType, request.action, request.code);
        case 'runs': {
          if (usesMarketVersions()) {
            return database.marketVersion
              .findMany({
                where: { isBaseline: false },
                select: { runId: true, phase: true, createdAt: true, finishedAt: true },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: request.limit,
              })
              .then((rows) =>
                rows.map((row) => ({
                  id: row.runId,
                  status: row.phase,
                  startedAt: row.createdAt,
                  finishedAt: row.finishedAt,
                })),
              );
          }
          const rows = await database.ingestionRun.findMany({
            select: {
              id: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              replicaPhase: true,
            },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: request.limit,
          });

          return rows.map(({ replicaPhase, ...row }) => ({
            ...row,
            status: replicaPhase ?? row.status,
          }));
        }
        case 'rollback-run':
        case 'retain-run':
        case 'release-run':
          return (await import('../version-admin.js')).manageMarketVersion(
            request.runId,
            request.action,
          );
        case 'inspect-run':
          return (await import('../replica.js')).inspectCandidate(request.runId, {
            includeBatchTimings: true,
          });
        case 'accept-run':
          return (await import('../replica.js')).acceptCandidate(
            request.runId,
            request.expectedVersion,
            controller.signal,
          );
        case 'reject-run':
          return (await import('../replica.js')).rejectCandidate(request.runId, request.reason);
        case 'recover-run':
          return (await import('../replica.js')).recoverCandidate(request.runId);
        case 'reconcile-issues': {
          const { reconcileIssueResolutions } = await import('../resolutions.js');

          if (usesMarketVersions()) {
            const version = await database.marketVersion.findUnique({ where: { activeSlot: 1 } });
            if (!version || (request.runId && version.runId !== request.runId)) {
              return { runs: [], created: 0 };
            }
            const { repairMarketVersion } = await import('../version-collection.js');
            return repairMarketVersion(version, true, () =>
              reconcileIssueResolutions(version.runId),
            );
          }
          return reconcileIssueResolutions(request.runId);
        }
        case 'repair-issues': {
          const { issueRepairPlanSchema } = await import('../repair-schema.js');
          const { repairIngestionIssues } = await import('../repair.js');
          const planFile = await stat(request.plan);
          if (!planFile.isFile() || planFile.size > 1024 * 1024) {
            throw new Error('Expected a repair JSON file of at most 1 MiB.');
          }
          const plan = issueRepairPlanSchema.parse(
            JSON.parse(await readFile(request.plan, 'utf8')),
          );

          const { repairCandidate } = await import('../replica.js');
          const { candidateFilename } = await import('../replica-files.js');
          const version = usesMarketVersions()
            ? await database.marketVersion.findUniqueOrThrow({ where: { runId: plan.runId } })
            : null;
          const path = version ? marketVersionFile(version.id) : candidateFilename(plan.runId);

          return repairCandidate(plan.runId, Boolean(request.expectedHash), () =>
            repairIngestionIssues(plan, {
              candidatePath: path,
              expectedHash: request.expectedHash,
              signal: controller.signal,
            }),
          );
        }
        case 'export-issues': {
          const { exportIngestionIssues } = await import('../issue-export.js');
          const { diagnosticCodeIdentity, writeIssueExportFile } =
            await import('./issue-export-file.js');
          const project = fileURLToPath(new URL('../../', apiDirectory));
          const code = await diagnosticCodeIdentity(project);
          const bundle = await readRun(request.runId, (_connection, dataLocation) =>
            exportIngestionIssues({
              runId: request.runId,
              issueId: request.issueId,
              code,
              dataLocation,
            }),
          );
          controller.signal.throwIfAborted();
          const output = await writeIssueExportFile(request.output, bundle, databaseFilename());

          return { output, counts: bundle.counts, limitations: bundle.limitations };
        }
        case 'issues':
          return readRun(request.runId, (connection) =>
            connection.ingestionIssue.findMany({
              where: { runId: request.runId },
              include: {
                resolution: {
                  select: { status: true, reason: true, resolvedAt: true, marketRevision: true },
                },
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
            }),
          );
        case 'reset': {
          const { resetBusinessData } = await import('../reset.js');
          const filename = databaseFilename();

          return resetBusinessData({
            apply: request.apply,
            transactionTimeoutMs:
              process.env.JIXIE_RESET_TRANSACTION_TIMEOUT_MS === undefined
                ? undefined
                : Number(process.env.JIXIE_RESET_TRANSACTION_TIMEOUT_MS),
            onLog: (message) => console.error(message),
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
      const source: import('#market/synchronization/source.js').SyncSource = {
        tracksHttp: true,
        call: (...args) => {
          if (!client) {
            const config = loadTushareConfig();
            client = new TushareClient({
              ...config,
              maxRetries: 2,
            });
          }
          return client.call(...args);
        },
      };
      // 先取得账号所有权再建立或修改 Run；读取类命令已在前面的分支返回。
      // Acquire provider ownership before changing a run; read-only commands returned above.
      client ??= new TushareClient({ ...loadTushareConfig(), maxRetries: 2 });
      await client.ready();
      if (request.action === 'select-top') {
        const { selectTopEtfs } = await import('#market/downloads/select-etfs.js');

        return selectTopEtfs({ source, limit: request.limit });
      }
      if (request.action === 'retry-run') {
        const { retryCandidate } = await import('../replica.js');

        return retryCandidate(request.runId, {
          source,
          signal: controller.signal,
          concurrency: loadTushareConfig().concurrency,
        });
      }
      if (request.action !== 'ingest') {
        throw new Error('Unsupported data action');
      }
      const { ingestCandidate } = await import('../replica.js');

      return ingestCandidate(
        {
          targetDate: request.targetDate ?? localDate(new Date()),
          source,
          signal: controller.signal,
          trigger: process.env.JIXIE_INGESTION_TRIGGER === 'timer' ? 'timer' : 'manual',
          concurrency: loadTushareConfig().concurrency,
        },
        Boolean(request.targetDate),
      );
    });
    console.log(JSON.stringify(result, null, 2));

    return (request.action === 'ingest' || request.action === 'retry-run') &&
      result &&
      'mode' in result &&
      result.mode === 'candidate' &&
      'phase' in result &&
      result.phase === 'interrupted'
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return error instanceof MarketAccessBusyError ? 75 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await client?.close();
    await closeDatabase(database);
  }
}
