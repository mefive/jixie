import { lstat, readdir, realpath, rm, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '#infra/database/prisma.js';
import {
  cleanupOwnerLocks,
  databaseFilename,
  withMaintenanceLock,
  acquireWorkOwner,
} from '#infra/coordination/market-access.js';
import { manifestSchema, type StagingManifest } from './manifest.js';
import { fingerprint, requirements, rulesFingerprint, stagingDirectory } from './identity.js';
import { schemaHash } from './snapshot.js';

interface CleanupOptions {
  apply: boolean;
  owners?: boolean;
}
interface CandidateCleanup {
  id: string;
  action: 'keep' | 'remove' | 'skip';
  reason: string;
  bytes: number;
  removed?: boolean;
  error?: string;
}

/** 只按正式凭据和恢复条件决定候选去留，清理状态不覆盖后处理状态。 / Decide retention from formal receipts and recovery inputs without replacing postprocess state. */
export async function cleanupMaintenanceArtifacts(options: CleanupOptions) {
  return withMaintenanceLock(async () => {
    const database = getDatabase();
    const root = resolve(dirname(databaseFilename()), 'maintenance-staging');
    const candidates: CandidateCleanup[] = [];
    const rootInfo = await lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) {
      throw new Error('Candidate root is not an owned directory');
    }
    const rows = await database.maintenanceRun.findMany({
      where: { targetKey: { startsWith: 'candidate:' } },
    });
    const revision =
      (await database.maintenanceState.findUnique({ where: { key: 'global' } }))?.dataRevision ?? 0;
    const ruleHash = await rulesFingerprint();
    const requirementHash = fingerprint(await requirements());
    const formal = new DatabaseSync(databaseFilename(), { readOnly: true });
    let formalSchema: string;
    try {
      formalSchema = schemaHash(formal);
    } finally {
      formal.close();
    }
    const known = new Set<string>();
    for (const row of rows) {
      const parsed = manifestSchema.safeParse(row.summary);
      if (!parsed.success || parsed.data.id !== row.id || row.targetKey !== `candidate:${row.id}`) {
        candidates.push({ id: row.id, action: 'skip', reason: 'unverified-record', bytes: 0 });
        continue;
      }
      let manifest = parsed.data;
      known.add(manifest.id);
      const directory = stagingDirectory(manifest.id);
      let result: CandidateCleanup | undefined;
      let postprocessOwner: Awaited<ReturnType<typeof acquireWorkOwner>> | undefined;
      try {
        const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return null;
          }
          throw error;
        });
        if (!info && manifest.cleanup?.state === 'complete') {
          continue;
        }
        if (
          info &&
          (!info.isDirectory() ||
            info.isSymbolicLink() ||
            (await realpath(directory)) !== directory)
        ) {
          candidates.push({
            id: manifest.id,
            action: 'skip',
            reason: 'unverified-directory',
            bytes: 0,
          });
          continue;
        }
        const candidateFile = await lstat(resolve(directory, 'candidate.db')).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
              return null;
            }
            throw error;
          },
        );
        const mainFile = await lstat(databaseFilename());
        if (
          candidateFile &&
          (!candidateFile.isFile() ||
            (candidateFile.dev === mainFile.dev && candidateFile.ino === mainFile.ino))
        ) {
          candidates.push({
            id: manifest.id,
            action: 'skip',
            reason: 'unverified-database',
            bytes: 0,
          });
          continue;
        }
        const valid =
          manifest.snapshot.baseRevision === revision &&
          manifest.snapshot.schemaHash === formalSchema &&
          manifest.rulesHash === ruleHash &&
          manifest.requirementsHash === requirementHash;
        const published =
          manifest.publishedRevision !== undefined &&
          row.status === 'done' &&
          ['published', 'done'].includes(manifest.phase);
        const inconsistentReceipt =
          !published &&
          (manifest.publishedRevision !== undefined ||
            row.status === 'done' ||
            ['published', 'done'].includes(manifest.phase));
        const recoverable =
          Boolean(info && candidateFile) &&
          valid &&
          (manifest.phase === 'ready' ||
            (manifest.phase === 'preparing' && manifest.failure?.kind === 'source'));
        const reason = published
          ? 'published'
          : inconsistentReceipt
            ? 'unverified-receipt'
            : manifest.cleanup?.state === 'pending'
              ? manifest.cleanup.reason
              : !valid
                ? 'obsolete-inputs'
                : recoverable
                  ? manifest.phase === 'ready'
                    ? 'publication-retry'
                    : 'source-retry'
                  : 'failed-or-interrupted';
        result = {
          id: manifest.id,
          action: inconsistentReceipt
            ? 'skip'
            : published || !recoverable || manifest.cleanup?.state === 'pending'
              ? 'remove'
              : 'keep',
          reason,
          bytes: info ? await directoryBytes(directory) : 0,
        };
        candidates.push(result);
        if (!options.apply || result.action !== 'remove') {
          continue;
        }
        if (published) {
          postprocessOwner = await acquireWorkOwner('postprocess', manifest.id);
          const current = await database.maintenanceRun.findUniqueOrThrow({
            where: { id: row.id },
          });
          manifest = manifestSchema.parse(current.summary);
          if (
            current.status !== 'done' ||
            manifest.publishedRevision === undefined ||
            !['published', 'done'].includes(manifest.phase)
          ) {
            throw new Error('Publication receipt changed during cleanup');
          }
        }

        // 删除前保存已有诊断和原目标；未知发布结果永远不靠目录猜测。
        // Persist diagnostics and the original target before deletion; never infer publication from files.
        if (!manifest.audit && info) {
          const audit = await readFile(resolve(directory, 'audit.json'), 'utf8').catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') {
                return undefined;
              }
              throw error;
            },
          );
          if (audit) {
            manifest.audit = JSON.parse(audit);
          }
        }
        manifest.cleanup = {
          state: 'pending',
          reason,
          at: new Date().toISOString(),
          bytes: result.bytes,
        };
        if (!published) {
          manifest.phase = 'abandoned';
        }
        await database.maintenanceRun.update({
          where: { id: row.id },
          data: { summary: serialize(manifest), ...(!published ? { status: 'error' } : {}) },
        });
        await rm(directory, { recursive: true, force: true });
        manifest.cleanup.state = 'complete';
        await database.maintenanceRun.update({
          where: { id: row.id },
          data: { summary: serialize(manifest) },
        });
        result.removed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (result) {
          result.error = message;
        } else {
          candidates.push({
            id: row.id,
            action: 'skip',
            reason: 'inspection-failed',
            bytes: 0,
            error: message,
          });
        }
      } finally {
        await postprocessOwner?.release();
      }
    }
    if (rootInfo) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!known.has(entry.name)) {
          candidates.push({ id: entry.name, action: 'skip', reason: 'unowned-entry', bytes: 0 });
        }
      }
    }
    const ownerLocks = options.owners === false ? [] : await cleanupOwnerLocks(options.apply);

    return { apply: options.apply, candidates, ownerLocks };
  });
}

async function directoryBytes(directory: string): Promise<number> {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      size += await directoryBytes(filename);
    } else if (entry.isFile()) {
      size += (await lstat(filename)).size;
    }
  }

  return size;
}

function serialize(manifest: StagingManifest) {
  return JSON.parse(JSON.stringify(manifest));
}
