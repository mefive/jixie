import type { MaintenanceRun } from '@prisma/client';
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  acquireWorkOwner,
  assertMaintenanceOwner,
  cleanupOwnerLocks,
  databaseFilename,
  MarketAccessBusyError,
} from '#infra/coordination/market-access.js';
import { getDatabase } from '#infra/database/prisma.js';
import { cleanReadCopies } from '#infra/database/read-copy.js';

const retiredManifest = z.object({
  protocol: z.literal(2),
  id: z.string().regex(/^[A-Z0-9]+$/),
  command: z.enum(['daily', 'weekly', 'repair', 'sync', 'canonicalize', 'import']),
  timestamp: z.iso.datetime(),
  phase: z.enum(['preparing', 'ready', 'published', 'done', 'abandoned']),
  snapshot: z.object({
    schemaHash: z.string(),
    baseRevision: z.number(),
    tables: z.array(z.string()),
  }),
  changes: z.array(
    z.object({
      table: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
      count: z.number().int().nonnegative(),
      hash: z.string(),
    }),
  ),
});

/**
 * 只回收有数据库归属记录且无活跃所有者的旧协议资源，未知文件不删除。
 *
 * Reclaim only database-owned retired resources without a live owner; unknown files remain
 * untouched.
 */
export async function cleanRetiredSyncResources(): Promise<string[]> {
  assertMaintenanceOwner();
  const filename = databaseFilename();
  const gaps = await cleanReadCopies(filename);
  const root = resolve(dirname(filename), 'maintenance-staging');
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return null;
  });
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root) {
      throw new Error('Unverified retired resource root');
    }
    const runs = await getDatabase().maintenanceRun.findMany({
      where: { targetKey: { startsWith: 'candidate:' } },
    });
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const run = runs.find(
        (row) => row.id === entry.name && row.targetKey === `candidate:${entry.name}`,
      );
      if (!entry.isDirectory() || entry.isSymbolicLink() || !run) {
        gaps.push(`Retained unverified retired resource: ${entry.name}`);
        continue;
      }
      const retained = await reclaimRetiredCandidate(resolve(root, entry.name), run, filename);
      if (retained) {
        gaps.push(retained);
      }
    }
  }
  await cleanupOwnerLocks(true);

  return gaps;
}

/**
 * 凭据和磁盘内容在持有 owner 时核验，未知文件或正式库别名均保留。
 *
 * Verify credentials and disk contents while owning the lock, retaining unknown files and aliases.
 */
async function verifyRetiredCandidate(directory: string, run: MaintenanceRun, filename: string) {
  const manifest = retiredManifest.parse(run.summary);
  const onDisk = retiredManifest.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  const identity = await lstat(directory);
  const formal = await lstat(filename);
  const candidate = await lstat(resolve(directory, 'candidate.db'));
  if (
    manifest.id !== run.id ||
    JSON.stringify(onDisk) !== JSON.stringify(manifest) ||
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    (await realpath(directory)) !== directory ||
    !candidate.isFile() ||
    candidate.isSymbolicLink() ||
    (formal.dev === candidate.dev && formal.ino === candidate.ino)
  ) {
    throw new Error('Unverified retired candidate identity');
  }
  const known = new Set([
    'manifest.json',
    'candidate.db',
    'candidate.db-wal',
    'candidate.db-shm',
    'baseline.db',
    'baseline.db-wal',
    'baseline.db-shm',
    'actions.jsonl',
    'snapshot.json',
    'requirements.json',
    'audit.json',
    ...manifest.changes.map((change) => `${change.table}.changes`),
  ]);
  const files = await readdir(directory, { withFileTypes: true });
  if (
    files.some(
      (file) =>
        !file.isFile() ||
        file.isSymbolicLink() ||
        (!known.has(file.name) &&
          !(file.name.endsWith('.tmp') && known.has(file.name.slice(0, -4)))),
    )
  ) {
    throw new Error('Retired candidate contains unknown files');
  }

  return identity;
}

async function reclaimRetiredCandidate(
  directory: string,
  run: MaintenanceRun,
  filename: string,
): Promise<string | null> {
  let owner;
  try {
    owner = await acquireWorkOwner('postprocess', run.id);
    let identity;
    try {
      identity = await verifyRetiredCandidate(directory, run, filename);
    } catch {
      return `Retained unverified retired candidate: ${run.id}`;
    }
    const audit = await readFile(resolve(directory, 'audit.json'), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return null;
      },
    );
    const summary =
      run.summary && typeof run.summary === 'object' && !Array.isArray(run.summary)
        ? run.summary
        : {};
    await getDatabase().maintenanceRun.update({
      where: { id: run.id },
      data: {
        summary: {
          ...summary,
          ...(audit ? { audit: z.json().parse(JSON.parse(audit)) } : {}),
          retiredCleanupAt: new Date().toISOString(),
        },
        ...(run.status === 'running'
          ? { status: 'interrupted', stage: 'retired', finishedAt: new Date() }
          : {}),
      },
    });
    const current = await lstat(directory);
    if (
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      !current.isDirectory() ||
      current.isSymbolicLink()
    ) {
      return `Retained replaced retired resource: ${run.id}`;
    }
    await rm(directory, { recursive: true });

    return null;
  } catch (error) {
    if (!(error instanceof MarketAccessBusyError)) {
      throw error;
    }
    return `Retained active retired resource: ${run.id}`;
  } finally {
    await owner?.release();
  }
}
