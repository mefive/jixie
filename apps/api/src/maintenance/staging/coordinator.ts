import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { access, readFile, readdir, rm, stat, statfs } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import pkg from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import {
  acquireMarketLock,
  acquireWorkOwner,
  databaseFilename,
  MarketAccessBusyError,
  withMaintenanceLock,
  withMarketAccess,
  withMarketPublication,
} from '#infra/coordination/market-access.js';
import { requirementsSchema, type StagingRequirements } from '#infra/coordination/staging-input.js';
import { generateDailySignals } from '#signals/daily/scheduler.js';
import { refreshAllFactorWeatherPins } from '#factor/weather/refresh.js';
import { scheduledDailyUpperBound } from '../workflows/daily-schedule.js';
import { applyTableChanges, freezeTableChanges } from './changes.js';
import { createStagingSnapshot, saveJson, schemaHash } from './snapshot.js';
import { maintenanceTables } from './tables.js';

import { manifestSchema, type StagingManifest, type MaintenanceCommand } from './manifest.js';
export type { MaintenanceCommand } from './manifest.js';

function payload(manifest: StagingManifest): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue;
}

async function requirements(): Promise<StagingRequirements> {
  return prisma.$transaction(async (transaction) => {
    const active = await transaction.strategyDeployment.findMany({
      where: { status: 'active' },
      orderBy: { id: 'asc' },
      select: { config: true, factorDependencies: true },
    });
    const versioned = await transaction.strategyDeployment.findMany({
      where: { accountingVersion: 2 },
      orderBy: { id: 'asc' },
      select: { config: true, status: true, accountStates: { take: 1, select: { id: true } } },
    });

    return {
      active,
      versioned: versioned.map((entry) => ({
        config: entry.config,
        status: entry.status,
        hasAccounts: entry.accountStates.length > 0,
      })),
    };
  });
}

function fingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** 代码变化使旧断点失效，开发环境也不依赖 Git HEAD。 / Invalidate checkpoints on code changes, including uncommitted development edits. */
async function rulesFingerprint(): Promise<string> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const digest = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
      } else if (/\.(ts|js|mjs|py|json)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        digest.update(filename.slice(root.length)).update(await readFile(filename));
      }
    }
  };
  await visit(root);
  await visit(fileURLToPath(new URL('../../../scripts/', import.meta.url)));
  const sharedDirectory = fileURLToPath(
    new URL(
      import.meta.url.includes('/dist/')
        ? '../../../../../../packages/shared/'
        : '../../../../../packages/shared/',
      import.meta.url,
    ),
  );
  await visit(sharedDirectory + (import.meta.url.endsWith('.ts') ? 'src' : 'dist'));
  digest.update(process.versions.node).update(process.env.JIXIE_APP_REVISION ?? 'development');

  return digest.digest('hex');
}

function stagingDirectory(id: string): string {
  if (!/^[A-Z0-9]+$/.test(id)) {
    throw new Error('Invalid staging identity');
  }

  return resolve(dirname(databaseFilename()), 'maintenance-staging', id);
}

async function prepareWorkflow(
  manifest: StagingManifest,
  directory: string,
  finalize = false,
): Promise<void> {
  const entry = fileURLToPath(new URL('../cli/run-maintenance.js', import.meta.url));
  const source = import.meta.url.endsWith('.ts') ? entry.replace(/\.js$/, '.ts') : entry;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${resolve(directory, 'candidate.db')}`,
    JIXIE_STAGING_DATABASE: `file:${resolve(directory, 'candidate.db')}`,
    JIXIE_FORMAL_DATABASE_URL: `file:${databaseFilename()}`,
    JIXIE_MAINTENANCE_CANDIDATE: manifest.id,
    JIXIE_MAINTENANCE_TIME: manifest.timestamp,
    JIXIE_MAINTENANCE_DATE: manifest.date,
    JIXIE_MAINTENANCE_UPPER_BOUND: manifest.upperBound,
  };
  delete environment.JIXIE_MAINTENANCE_LOCK_FD;
  delete environment.JIXIE_MARKET_PUBLISH_LOCK_FD;
  delete environment.JIXIE_MARKET_ACCESS_LOCK_FD;
  const args = finalize
    ? ['finalize', manifest.command]
    : [manifest.command, ...manifest.args.filter((argument) => argument !== '--resume-only')];
  const child = fork(source, args, {
    env: environment,
    execArgv: source.endsWith('.ts') ? process.execArgv : [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let progress = Promise.resolve();
  let failure: unknown;
  const terminate = () => {
    child.kill('SIGTERM');
  };
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  child.on('message', (message: unknown) => {
    const value = z
      .object({
        type: z.literal('maintenance-progress'),
        stage: z.string(),
        summary: z.unknown().optional(),
      })
      .safeParse(message);
    if (!value.success) {
      failure = new Error('Invalid candidate progress message');
      child.kill();
      return;
    }
    progress = progress
      .then(async () => {
        await prisma.maintenanceRun.update({
          where: { id: manifest.id },
          data: {
            stage: value.data.stage,
            heartbeatAt: new Date(),
            summary: {
              ...(payload(manifest) as object),
              progress: JSON.parse(JSON.stringify(value.data.summary ?? null)),
            },
          },
        });
      })
      .catch((error: unknown) => {
        failure = error;
        child.kill();
      });
  });
  try {
    await new Promise<void>((resolveDone, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        void progress.then(() => {
          if (failure) {
            reject(failure);
          } else if (code === 0) {
            resolveDone();
          } else {
            reject(new Error(`Candidate preparation failed (${signal ?? code})`));
          }
        }, reject);
      });
    });
  } finally {
    process.removeListener('SIGINT', terminate);
    process.removeListener('SIGTERM', terminate);
  }
}

async function freezeChanges(manifest: StagingManifest, directory: string): Promise<void> {
  const source = new DatabaseSync(databaseFilename(), { readOnly: true });
  const candidate = new DatabaseSync(resolve(directory, 'candidate.db'), { readOnly: true });
  try {
    source.exec('BEGIN');
    if (
      schemaHash(source) !== manifest.snapshot.schemaHash ||
      schemaHash(candidate) !== manifest.snapshot.schemaHash
    ) {
      throw new Error('Schema changed while preparing market candidates');
    }
    const state = source
      .prepare('SELECT dataRevision FROM MaintenanceState WHERE key = ?')
      .get('global');
    if ((state?.dataRevision ?? 0) !== manifest.snapshot.baseRevision) {
      throw new Error('Market baseline changed; rebuild the candidate');
    }
    manifest.changes = maintenanceTables(manifest.command, manifest.args).map((table) =>
      freezeTableChanges(source, candidate, directory, table),
    );
    source.exec('COMMIT');
    const result = candidate
      .prepare('SELECT summary FROM MaintenanceRun ORDER BY startedAt DESC LIMIT 1')
      .get();
    manifest.result = result?.summary ? JSON.parse(String(result.summary)) : null;
  } finally {
    candidate.close();
    source.close();
  }
  const audit = await readFile(resolve(directory, 'audit.json'), 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return undefined;
    },
  );
  if (audit) {
    manifest.audit = z.json().parse(JSON.parse(audit));
  }
  const text = await readFile(resolve(directory, 'actions.jsonl'), 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return '';
    },
  );
  const actions: unknown[] = text.trim()
    ? text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  manifest.actions = manifestSchema.shape.actions.parse([
    ...new Map(actions.map((action) => [JSON.stringify(action), action])).values(),
  ]);
}

async function publish(manifest: StagingManifest, directory: string): Promise<void> {
  const candidate = new DatabaseSync(resolve(directory, 'candidate.db'), { readOnly: true });
  let candidateState: {
    dailyPublishedThrough?: string | null;
    weeklySyncedThrough?: string | null;
  };
  try {
    candidateState =
      candidate.prepare('SELECT * FROM MaintenanceState WHERE key = ?').get('global') ?? {};
  } finally {
    candidate.close();
  }
  await withMarketPublication(async () => {
    if (fingerprint(await requirements()) !== manifest.requirementsHash) {
      throw new Error('Deployment requirements changed; retry to rebuild the candidate');
    }
    const inspector = new DatabaseSync(databaseFilename(), { readOnly: true });
    try {
      if (schemaHash(inspector) !== manifest.snapshot.schemaHash) {
        throw new Error('Formal schema changed before publication');
      }
    } finally {
      inspector.close();
    }
    const publisher = new pkg.PrismaClient();
    try {
      await publisher.$queryRawUnsafe('PRAGMA busy_timeout=5000');
      await publisher.$transaction(
        async (transaction) => {
          const receipt = await transaction.maintenanceRun.findUniqueOrThrow({
            where: { id: manifest.id },
          });
          const existing = manifestSchema.parse(receipt.summary);
          if (existing.publishedRevision !== undefined) {
            Object.assign(manifest, existing);
            return;
          }
          const state = await transaction.maintenanceState.findUnique({ where: { key: 'global' } });
          if ((state?.dataRevision ?? 0) !== manifest.snapshot.baseRevision) {
            throw new Error('Formal market revision changed before publication');
          }
          const tables = maintenanceTables(manifest.command, manifest.args);
          // 先按反向依赖删除，再按正向依赖增改；整个过程只有一次提交。
          // Delete in reverse dependency order, then apply inserts/updates in forward order in one commit.
          for (const mode of ['delete', 'write'] as const) {
            for (const table of mode === 'delete' ? [...tables].reverse() : tables) {
              const changes = manifest.changes.find((entry) => entry.table === table.name);
              if (!changes) {
                throw new Error(`Missing domain publication manifest: ${table.name}`);
              }
              await applyTableChanges(transaction, directory, table, changes, mode);
            }
          }
          const daily =
            candidateState.dailyPublishedThrough ?? state?.dailyPublishedThrough ?? null;
          const weekly = candidateState.weeklySyncedThrough ?? state?.weeklySyncedThrough ?? null;
          if (
            (state?.dailyPublishedThrough && (!daily || daily < state.dailyPublishedThrough)) ||
            (state?.weeklySyncedThrough && (!weekly || weekly < state.weeklySyncedThrough))
          ) {
            throw new Error('A candidate cannot move published watermarks backwards');
          }
          const changed =
            manifest.changes.some((entry) => entry.count > 0) ||
            daily !== (state?.dailyPublishedThrough ?? null) ||
            weekly !== (state?.weeklySyncedThrough ?? null);
          const published = await transaction.maintenanceState.upsert({
            where: { key: 'global' },
            create: {
              key: 'global',
              dailyPublishedThrough: daily,
              weeklySyncedThrough: weekly,
              dataRevision: changed ? 1 : 0,
            },
            update: {
              dailyPublishedThrough: daily,
              weeklySyncedThrough: weekly,
              dataRevision: { increment: changed ? 1 : 0 },
            },
          });
          const receiptManifest = {
            ...manifest,
            publishedRevision: published.dataRevision,
            phase: 'published' as const,
          };
          await transaction.maintenanceRun.update({
            where: { id: manifest.id },
            data: {
              stage: 'published',
              status: 'done',
              finishedAt: new Date(),
              heartbeatAt: new Date(),
              error: null,
              summary: payload(receiptManifest),
            },
          });
          if (['weekly', 'repair', 'import', 'canonicalize'].includes(manifest.command)) {
            await transaction.maintenanceRun.updateMany({
              where: {
                kind: { in: ['daily', 'weekly', 'repair'] },
                status: { in: ['running', 'error'] },
                NOT: { targetKey: { startsWith: 'candidate:' } },
              },
              data: { status: 'done', stage: 'revalidated', error: null, finishedAt: new Date() },
            });
          }
        },
        { maxWait: 30_000, timeout: 30 * 60_000 },
      );
    } finally {
      // 释放 R/P 前关闭专用引擎，避免未知提交结果留下仍能继续写入的连接。
      // Close the dedicated engine before releasing R/P, including indeterminate transaction outcomes.
      try {
        await publisher.$disconnect();
      } catch (error) {
        console.error(
          '[maintenance] publication connection shutdown is uncertain; terminating the coordinator',
          error,
        );
        process.exit(1);
      }
    }
    // 正式凭据是唯一发布事实，内存状态不能先于事务提交。
    // Update in-memory state only from the committed formal receipt.
    const receipt = await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: manifest.id } });
    Object.assign(manifest, manifestSchema.parse(receipt.summary));
  });
}

async function postprocess(runId: string): Promise<void> {
  let owner;
  try {
    owner = await acquireWorkOwner('postprocess', runId);
  } catch (error) {
    if (error instanceof MarketAccessBusyError) {
      return;
    }
    throw error;
  }
  try {
    const row = await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: runId } });
    const manifest = manifestSchema.parse(row.summary);
    if (manifest.publishedRevision === undefined) {
      throw new Error('Postprocessing requires a committed publication receipt');
    }
    try {
      for (const action of manifest.actions) {
        const key = JSON.stringify(action);
        if (manifest.completedActions.includes(key)) {
          continue;
        }
        await withMarketAccess(async () => {
          if (action.kind === 'signals') {
            const result = await generateDailySignals(action.tradeDate);
            if (result.errors) {
              throw new Error(`Signal postprocessing has ${result.errors} failures`);
            }
          } else {
            await refreshAllFactorWeatherPins({ strict: true });
          }
        });
        manifest.completedActions.push(key);
        await prisma.maintenanceRun.update({
          where: { id: runId },
          data: { summary: payload(manifest), stage: 'postprocessing', error: null },
        });
      }
      manifest.phase = 'done';
      await prisma.maintenanceRun.update({
        where: { id: runId },
        data: { summary: payload(manifest), stage: 'complete', error: null },
      });
    } catch (error) {
      await prisma.maintenanceRun.update({
        where: { id: runId },
        data: {
          stage: 'postprocess_error',
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  } finally {
    await owner.release();
  }
}

/** 只清理有正式完成凭据的私有目录，清理失败不影响已发布数据。 / Clean only receipted private directories; cleanup never changes publication success. */
async function cleanupCompleted(): Promise<void> {
  await withMaintenanceLock(async () => {
    const rows = await prisma.maintenanceRun.findMany({
      where: {
        targetKey: { startsWith: 'candidate:' },
        OR: [
          { status: 'done', stage: 'complete' },
          { stage: 'abandoned', updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
        ],
      },
    });
    for (const row of rows) {
      const parsed = manifestSchema.safeParse(row.summary);
      const abandonedExpired =
        parsed.success &&
        parsed.data.phase === 'abandoned' &&
        Date.now() - row.updatedAt.getTime() > 7 * 24 * 60 * 60_000;
      if (!parsed.success || (parsed.data.phase !== 'done' && !abandonedExpired)) {
        continue;
      }
      let owner;
      try {
        owner = await acquireMarketLock(`owner-${parsed.data.id}`);
      } catch (error) {
        if (error instanceof MarketAccessBusyError) {
          continue;
        }
        throw error;
      }
      try {
        await rm(stagingDirectory(parsed.data.id), { recursive: true, force: true });
        await prisma.maintenanceRun.update({
          where: { id: row.id },
          data: { stage: abandonedExpired ? 'cleaned_abandoned' : 'cleaned' },
        });
      } finally {
        await owner.release();
      }
    }
  });
}

async function candidateIsCurrent(
  manifest: StagingManifest,
  rulesHash: string,
  requirementsHash: string,
): Promise<boolean> {
  if (manifest.rulesHash !== rulesHash || manifest.requirementsHash !== requirementsHash) {
    return false;
  }
  const formal = new DatabaseSync(databaseFilename(), { readOnly: true });
  try {
    const state = formal
      .prepare('SELECT dataRevision FROM MaintenanceState WHERE key = ?')
      .get('global');
    if (
      (state?.dataRevision ?? 0) !== manifest.snapshot.baseRevision ||
      schemaHash(formal) !== manifest.snapshot.schemaHash
    ) {
      return false;
    }
  } finally {
    formal.close();
  }
  try {
    const directory = stagingDirectory(manifest.id);
    await access(resolve(directory, 'candidate.db'));
    const input = requirementsSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'requirements.json'), 'utf8')),
    );
    if (fingerprint(input) !== manifest.requirementsHash) {
      return false;
    }
    manifestSchema.parse(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')));
    if (manifest.phase === 'ready') {
      for (const changes of manifest.changes) {
        if (!manifest.snapshot.tables.includes(changes.table)) {
          return false;
        }
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(
          resolve(directory, `${changes.table}.changes`),
        )) {
          digest.update(chunk);
        }
        if (digest.digest('hex') !== changes.hash) {
          return false;
        }
      }
    }
    const candidate = new DatabaseSync(resolve(stagingDirectory(manifest.id), 'candidate.db'), {
      readOnly: true,
    });
    try {
      return (
        schemaHash(candidate) === manifest.snapshot.schemaHash &&
        candidate.prepare('PRAGMA quick_check').get()?.quick_check === 'ok'
      );
    } finally {
      candidate.close();
    }
  } catch {
    return false;
  }
}

export async function runStagedMaintenance(
  command: MaintenanceCommand,
  args: string[],
): Promise<void> {
  await retryPublishedActions();
  await withMaintenanceLock(async () => {
    await cleanupCompleted();
    const rows = await prisma.maintenanceRun.findMany({
      where: {
        targetKey: { startsWith: 'candidate:' },
        status: { in: ['running', 'error'] },
        NOT: { stage: { in: ['abandoned', 'cleaned_abandoned'] } },
      },
      orderBy: { startedAt: 'asc' },
    });
    const pending = rows
      .map((row) => manifestSchema.safeParse(row.summary))
      .find(
        (entry) =>
          entry.success &&
          ['preparing', 'ready'].includes(entry.data.phase) &&
          entry.data.command === command &&
          (args.includes('--resume-only')
            ? !entry.data.args.includes('--initialize-only')
            : JSON.stringify(entry.data.args) === JSON.stringify(args)),
      );
    let manifest = pending?.success ? pending.data : undefined;
    if (!manifest && args.includes('--resume-only')) {
      return;
    }
    const inputs = await withMarketAccess(requirements);
    const rulesHash = await rulesFingerprint();
    const requirementsHash = fingerprint(inputs);
    const original = manifest;
    if (manifest) {
      const previousWriter = await acquireMarketLock(`owner-${manifest.id}`);
      try {
        if (!(await candidateIsCurrent(manifest, rulesHash, requirementsHash))) {
          manifest.phase = 'abandoned';
          await prisma.maintenanceRun.update({
            where: { id: manifest.id },
            data: {
              summary: payload(manifest),
              status: 'error',
              stage: 'abandoned',
              error: 'Candidate inputs changed; rebuilding the same target',
            },
          });
          manifest = undefined;
        }
      } finally {
        await previousWriter.release();
      }
    }
    if (!manifest) {
      const id = ulid();
      const now = original ? new Date(original.timestamp) : new Date();
      const date =
        original?.date ??
        new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .format(now)
          .replaceAll('-', '');
      const directory = stagingDirectory(id);
      const free = await statfs(dirname(databaseFilename()));
      const sourceSize = (await stat(databaseFilename())).size;
      if (free.bavail * free.bsize < sourceSize * 2 + 256 * 1024 * 1024) {
        throw new Error('Insufficient space for an isolated maintenance candidate');
      }
      manifest = {
        protocol: 2,
        id,
        command,
        args: original?.args ?? args,
        date,
        timestamp: now.toISOString(),
        upperBound: original?.upperBound ?? scheduledDailyUpperBound(now),
        phase: 'preparing',
        rulesHash,
        requirementsHash,
        snapshot: {
          schemaHash: '',
          baseRevision: -1,
          tables: maintenanceTables(command, original?.args ?? args).map((table) => table.name),
        },
        changes: [],
        actions: [],
        completedActions: [],
      };
      await prisma.maintenanceRun.create({
        data: {
          id,
          kind: ['sync', 'canonicalize', 'import'].includes(command) ? 'repair' : command,
          targetKey: `candidate:${id}`,
          trigger: process.env.INVOCATION_ID ? 'timer' : 'manual',
          status: 'running',
          stage: 'preparing',
          summary: payload(manifest),
        },
      });
      try {
        manifest.snapshot = await createStagingSnapshot(
          databaseFilename(),
          directory,
          maintenanceTables(command, manifest.args),
        );
        await saveJson(resolve(directory, 'requirements.json'), inputs);
        await saveJson(resolve(directory, 'manifest.json'), manifest);
        await prisma.maintenanceRun.update({ where: { id }, data: { summary: payload(manifest) } });
      } catch (error) {
        await prisma.maintenanceRun.update({
          where: { id },
          data: {
            status: 'error',
            stage: 'snapshot_error',
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    }
    const directory = stagingDirectory(manifest.id);
    try {
      await prisma.maintenanceRun.update({
        where: { id: manifest.id },
        data: {
          status: 'running',
          stage: manifest.phase,
          error: null,
          attempts: { increment: original ? 1 : 0 },
        },
      });
      if (manifest.phase === 'preparing') {
        await prepareWorkflow(manifest, directory);
        const finishedWriters = await acquireMarketLock(`owner-${manifest.id}`);
        try {
          await freezeChanges(manifest, directory);
        } finally {
          await finishedWriters.release();
        }
        // 先检测实际变化，再在候选中重算影响范围并做最终审计。
        // Detect actual changes before recomputing affected outputs and auditing the candidate.
        await saveJson(resolve(directory, 'manifest.json'), manifest);
        await prepareWorkflow(manifest, directory, true);
        const frozen = await acquireMarketLock(`owner-${manifest.id}`);
        try {
          await freezeChanges(manifest, directory);
        } finally {
          await frozen.release();
        }
        manifest.phase = 'ready';
        await saveJson(resolve(directory, 'manifest.json'), manifest);
        await prisma.maintenanceRun.update({
          where: { id: manifest.id },
          data: { summary: payload(manifest), stage: 'ready' },
        });
      }
      await publish(manifest, directory);
    } catch (error) {
      const receipt = await prisma.maintenanceRun.findUniqueOrThrow({ where: { id: manifest.id } });
      const persisted = manifestSchema.parse(receipt.summary);
      if (persisted.publishedRevision !== undefined) {
        Object.assign(manifest, persisted);
      } else {
        await prisma.maintenanceRun.update({
          where: { id: manifest.id },
          data: {
            status: 'error',
            stage: 'candidate_error',
            summary: payload(manifest),
            error: error instanceof Error ? error.message : String(error),
            heartbeatAt: new Date(),
          },
        });
        throw error;
      }
    }
  });
  if (await retryPublishedActions()) {
    process.exitCode = 1;
  }
  await cleanupCompleted().catch((error: unknown) =>
    console.warn('[maintenance] cleanup deferred', error),
  );
}

async function retryPublishedActions(): Promise<number> {
  let failures = 0;
  const rows = await prisma.maintenanceRun.findMany({
    where: {
      targetKey: { startsWith: 'candidate:' },
      status: 'done',
      stage: { in: ['published', 'postprocessing', 'postprocess_error'] },
    },
    orderBy: { startedAt: 'asc' },
  });
  for (const row of rows) {
    const parsed = manifestSchema.safeParse(row.summary);
    if (parsed.success && parsed.data.phase === 'published') {
      await postprocess(row.id).catch((error: unknown) => {
        console.error('[maintenance] published; follow-up work remains retryable', {
          runId: row.id,
          error,
        });
        failures++;
      });
    }
  }

  return failures;
}
