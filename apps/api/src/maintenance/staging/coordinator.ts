import { requirements, fingerprint, rulesFingerprint, stagingDirectory } from './identity.js';
import { cleanupMaintenanceArtifacts } from './cleanup.js';
import { isMarketSourceFailure } from '#market/errors.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { access, readFile, stat, statfs, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  getDatabase,
  createDatabase,
  withDatabase,
  closeDatabase,
} from '#infra/database/prisma.js';
import { withStagingContext } from '#infra/coordination/staging-input.js';
import { executeMaintenanceWorkflow } from '../workflows/execute.js';
import { finalizeCandidate } from './finalize.js';
import {
  acquireWorkOwner,
  databaseFilename,
  MarketAccessBusyError,
  withMaintenanceLock,
  withMarketAccess,
  withMarketPublication,
} from '#infra/coordination/market-access.js';
import { requirementsSchema } from '#infra/coordination/staging-input.js';
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

/** 记录阶段耗时和正式控制进度，不改变市场数据。 / Record stage timings and control progress without changing market data. */
async function measureStage<Result>(
  manifest: StagingManifest,
  stage: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  await getDatabase().maintenanceRun.update({
    where: { id: manifest.id },
    data: { stage, heartbeatAt: new Date() },
  });
  const started = performance.now();
  console.info(`[maintenance] ${stage} started`);
  try {
    return await operation();
  } finally {
    const elapsed = Math.round(performance.now() - started);
    manifest.timings = { ...manifest.timings, [stage]: elapsed };
    console.info(`[maintenance] ${stage} finished: ${elapsed} ms`);
  }
}

async function prepareWorkflow(
  manifest: StagingManifest,
  directory: string,
  finalize = false,
): Promise<void> {
  const formal = getDatabase();
  const candidate = createDatabase(`file:${resolve(directory, 'candidate.db')}`);
  const requirements = requirementsSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'requirements.json'), 'utf8')),
  );
  try {
    await withStagingContext(
      {
        id: manifest.id,
        directory,
        formalUrl: `file:${databaseFilename()}`,
        timestamp: manifest.timestamp,
        date: manifest.date,
        upperBound: manifest.upperBound,
        requirements,
        reportProgress: async (stage, summary) => {
          manifest.progress = JSON.parse(JSON.stringify(summary ?? null));
          await formal.maintenanceRun.update({
            where: { id: manifest.id },
            data: {
              stage,
              heartbeatAt: new Date(),
              summary: {
                ...(payload(manifest) as object),
                progress: JSON.parse(JSON.stringify(summary ?? null)),
              },
            },
          });
        },
      },
      () =>
        withDatabase(candidate, async () => {
          if (finalize) {
            await finalizeCandidate();
          } else {
            await executeMaintenanceWorkflow(
              manifest.command,
              manifest.args.filter((argument) => argument !== '--resume-only'),
            );
          }
        }),
    );
  } finally {
    await closeDatabase(candidate);
  }
}

async function freezeChanges(manifest: StagingManifest, directory: string): Promise<void> {
  const source = new DatabaseSync(databaseFilename(), { readOnly: true });
  const candidate = new DatabaseSync(resolve(directory, 'candidate.db'), { readOnly: true });
  try {
    source.exec('BEGIN');
    if (
      schemaHash(source) !== manifest.snapshot.schemaHash ||
      schemaHash(candidate, maintenanceTables(manifest.command, manifest.args)) !==
        manifest.snapshot.schemaHash
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
      .prepare(
        'SELECT summary FROM MaintenanceRun ORDER BY (kind = ?) DESC, startedAt DESC LIMIT 1',
      )
      .get(manifest.command);
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
  const waiting = performance.now();
  await withMarketPublication(async () => {
    console.info(
      `[maintenance] publication lock acquired: ${Math.round(performance.now() - waiting)} ms`,
    );
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
    const publisher = createDatabase(`file:${databaseFilename()}`);
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
        await closeDatabase(publisher);
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
    const receipt = await getDatabase().maintenanceRun.findUniqueOrThrow({
      where: { id: manifest.id },
    });
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
    const row = await getDatabase().maintenanceRun.findUniqueOrThrow({ where: { id: runId } });
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
        await getDatabase().maintenanceRun.update({
          where: { id: runId },
          data: { summary: payload(manifest), stage: 'postprocessing', error: null },
        });
      }
      manifest.phase = 'done';
      await getDatabase().maintenanceRun.update({
        where: { id: runId },
        data: { summary: payload(manifest), stage: 'complete', error: null },
      });
    } catch (error) {
      await getDatabase().maintenanceRun.update({
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
    const entry = await lstat(directory);
    const candidateEntry = await lstat(resolve(directory, 'candidate.db'));
    const formalEntry = await lstat(databaseFilename());
    if (
      !entry.isDirectory() ||
      (await realpath(directory)) !== directory ||
      !candidateEntry.isFile() ||
      (candidateEntry.dev === formalEntry.dev && candidateEntry.ino === formalEntry.ino)
    ) {
      return false;
    }
    await access(resolve(directory, 'candidate.db'));
    const input = requirementsSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'requirements.json'), 'utf8')),
    );
    if (fingerprint(input) !== manifest.requirementsHash) {
      return false;
    }
    const frozen = manifestSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
    );
    if (
      frozen.id !== manifest.id ||
      frozen.rulesHash !== manifest.rulesHash ||
      frozen.requirementsHash !== manifest.requirementsHash
    ) {
      return false;
    }
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
        schemaHash(candidate, maintenanceTables(manifest.command, manifest.args)) ===
          manifest.snapshot.schemaHash &&
        candidate.prepare('PRAGMA quick_check').get()?.quick_check === 'ok'
      );
    } finally {
      candidate.close();
    }
  } catch {
    return false;
  }
}

/** 在同一 M 所有权内准备、发布并回收候选，再独立重试后处理。 / Prepare, publish and reclaim under one M scope, then retry postprocessing independently. */
export async function runStagedMaintenance(
  command: MaintenanceCommand,
  args: string[],
): Promise<void> {
  await retryPublishedActions();
  await withMaintenanceLock(async () => {
    try {
      await reclaimArtifacts(false);
      const rows = await getDatabase().maintenanceRun.findMany({
        where: {
          targetKey: { startsWith: 'candidate:' },
          status: { in: ['running', 'error'] },
          NOT: { stage: 'abandoned' },
        },
        orderBy: { startedAt: 'asc' },
      });
      const pending = rows
        .map((row) => manifestSchema.safeParse(row.summary))
        .find(
          (entry) =>
            entry.success &&
            ['preparing', 'ready', 'abandoned'].includes(entry.data.phase) &&
            !entry.data.replacementId &&
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
        if (
          manifest.phase === 'abandoned' ||
          !(await candidateIsCurrent(manifest, rulesHash, requirementsHash))
        ) {
          manifest.phase = 'abandoned';
          await getDatabase().maintenanceRun.update({
            where: { id: manifest.id },
            data: {
              summary: payload(manifest),
              status: 'error',
              error: 'Candidate inputs changed; rebuilding the same target',
            },
          });
          manifest = undefined;
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
        const createdManifest = manifest;
        await getDatabase().$transaction(async (transaction) => {
          await transaction.maintenanceRun.create({
            data: {
              id,
              kind: ['sync', 'canonicalize', 'import'].includes(command) ? 'repair' : command,
              targetKey: `candidate:${id}`,
              trigger: process.env.INVOCATION_ID ? 'timer' : 'manual',
              status: 'running',
              stage: 'preparing',
              summary: payload(createdManifest),
            },
          });
          if (original) {
            original.replacementId = id;
            await transaction.maintenanceRun.update({
              where: { id: original.id },
              data: { summary: payload(original) },
            });
          }
        });
        try {
          manifest.snapshot = await measureStage(manifest, 'snapshot', () =>
            createStagingSnapshot(
              databaseFilename(),
              directory,
              maintenanceTables(command, manifest!.args),
            ),
          );
          await saveJson(resolve(directory, 'requirements.json'), inputs);
          await saveJson(resolve(directory, 'manifest.json'), manifest);
          await getDatabase().maintenanceRun.update({
            where: { id },
            data: { summary: payload(manifest) },
          });
        } catch (error) {
          await getDatabase().maintenanceRun.update({
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
        delete manifest.failure;
        await getDatabase().maintenanceRun.update({
          where: { id: manifest.id },
          data: {
            status: 'running',
            stage: manifest.phase,
            summary: payload(manifest),
            error: null,
            attempts: { increment: original ? 1 : 0 },
          },
        });
        if (manifest.phase === 'preparing') {
          await measureStage(manifest, 'preparation', () => prepareWorkflow(manifest!, directory));
          await measureStage(manifest, 'input_changes', () => freezeChanges(manifest!, directory));
          // 先检测实际变化，再在候选中重算影响范围并做最终审计。
          // Detect actual changes before recomputing affected outputs and auditing the candidate.
          await saveJson(resolve(directory, 'manifest.json'), manifest);
          await measureStage(manifest, 'finalization', () =>
            prepareWorkflow(manifest!, directory, true),
          );
          await measureStage(manifest, 'final_changes', () => freezeChanges(manifest!, directory));
          manifest.phase = 'ready';
          await saveJson(resolve(directory, 'manifest.json'), manifest);
          await getDatabase().maintenanceRun.update({
            where: { id: manifest.id },
            data: { summary: payload(manifest), stage: 'ready' },
          });
        }
        await measureStage(manifest, 'publication', () => publish(manifest!, directory));
        await getDatabase().maintenanceRun.update({
          where: { id: manifest.id },
          data: { summary: payload(manifest) },
        });
      } catch (error) {
        const receipt = await getDatabase().maintenanceRun.findUniqueOrThrow({
          where: { id: manifest.id },
        });
        const persisted = manifestSchema.parse(receipt.summary);
        if (persisted.publishedRevision !== undefined) {
          Object.assign(manifest, persisted);
        } else {
          manifest.failure = {
            kind: isMarketSourceFailure(error) ? 'source' : 'other',
            message: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          };
          await getDatabase().maintenanceRun.update({
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
    } finally {
      await reclaimArtifacts();
    }
  });
  if (await retryPublishedActions()) {
    process.exitCode = 1;
  }
}

async function retryPublishedActions(): Promise<number> {
  let failures = 0;
  const rows = await getDatabase().maintenanceRun.findMany({
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

async function reclaimArtifacts(owners = true): Promise<void> {
  try {
    const result = await cleanupMaintenanceArtifacts({ apply: true, owners });
    for (const candidate of result.candidates) {
      if (candidate.error) {
        console.warn('[maintenance] cleanup deferred', candidate.id, candidate.error);
      }
    }
  } catch (error) {
    console.warn('[maintenance] cleanup deferred', error);
  }
}
