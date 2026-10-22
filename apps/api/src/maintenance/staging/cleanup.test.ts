import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { withDatabase, type Prisma } from '#infra/database/prisma.js';
import { cleanupMaintenanceArtifacts } from './cleanup.js';
import { schemaHash } from './snapshot.js';
import type { StagingManifest } from './manifest.js';

vi.mock('./identity.js', async (original) => ({
  ...(await original<typeof import('./identity.js')>()),
  rulesFingerprint: async () => 'rules',
  requirements: async () => ({ active: [], versioned: [] }),
  fingerprint: () => 'requirements',
}));

let directory: string;
let schema: string;
let rows: Array<{
  id: string;
  targetKey: string;
  status: string;
  stage: string;
  summary: StagingManifest;
}>;
const database = {
  maintenanceState: { findUnique: async () => ({ dataRevision: 7 }) },
  maintenanceRun: {
    findMany: async () => rows,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id)!,
    update: vi.fn(async ({ where, data }) => {
      const row = rows.find((entry) => entry.id === where.id)!;
      Object.assign(row, JSON.parse(JSON.stringify(data)));
      return row;
    }),
  },
} as unknown as Prisma;

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-cleanup-'));
  vi.stubEnv('DATABASE_URL', `file:${resolve(directory, 'formal.db')}`);
  const formal = new DatabaseSync(resolve(directory, 'formal.db'));
  formal.exec('CREATE TABLE Evidence (id INTEGER)');
  schema = schemaHash(formal);
  formal.close();
  rows = [];
  vi.mocked(database.maintenanceRun.update).mockClear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function candidate(id: string, changes: Partial<StagingManifest> = {}, status = 'error') {
  const manifest: StagingManifest = {
    protocol: 2,
    id,
    command: 'repair',
    args: ['20260731', '20260813'],
    date: '20261021',
    timestamp: '2026-10-21T00:00:00Z',
    upperBound: '20261020',
    phase: 'preparing',
    rulesHash: 'rules',
    requirementsHash: 'requirements',
    snapshot: { schemaHash: schema, baseRevision: 7, tables: [] },
    changes: [],
    actions: [],
    completedActions: [],
    ...changes,
  };
  const path = resolve(directory, 'maintenance-staging', id);
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'candidate.db'), 'isolated');
  await writeFile(
    resolve(path, 'requirements.json'),
    JSON.stringify({ active: [], versioned: [] }),
  );
  await writeFile(resolve(path, 'manifest.json'), JSON.stringify(manifest));
  const row = {
    id,
    targetKey: `candidate:${id}`,
    status,
    stage: 'candidate_error',
    summary: manifest,
  };
  rows.push(row);
  return { path, row };
}
const cleanup = (apply: boolean) =>
  withDatabase(database, () => cleanupMaintenanceArtifacts({ apply }));
const sourceFailure = { kind: 'source' as const, message: 'offline', at: '2026-10-21T00:00:00Z' };

describe('maintenance artifact retention', () => {
  it('previews without deleting or changing receipts', async () => {
    const { path } = await candidate('FAILED');
    const result = await cleanup(false);
    expect(result.candidates).toEqual([
      expect.objectContaining({ id: 'FAILED', action: 'remove', bytes: expect.any(Number) }),
    ]);
    expect(await readFile(resolve(path, 'candidate.db'), 'utf8')).toBe('isolated');
    expect(database.maintenanceRun.update).not.toHaveBeenCalled();
  });

  it('keeps source checkpoints and ready publication retries, removes computation and interrupted attempts', async () => {
    await candidate('SOURCE', { failure: sourceFailure });
    await candidate('READY', { phase: 'ready' });
    await candidate('COMPUTE', { failure: { ...sourceFailure, kind: 'other' } });
    await candidate('INTERRUPTED');
    const result = await cleanup(true);
    expect(result.candidates.map(({ id, action }) => [id, action])).toEqual([
      ['SOURCE', 'keep'],
      ['READY', 'keep'],
      ['COMPUTE', 'remove'],
      ['INTERRUPTED', 'remove'],
    ]);
    expect(rows[2].summary).toMatchObject({
      phase: 'abandoned',
      cleanup: { state: 'complete' },
      args: ['20260731', '20260813'],
    });
    await expect(
      readFile(resolve(directory, 'maintenance-staging/COMPUTE/candidate.db')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await cleanup(true)).candidates.map((entry) => entry.id)).toEqual(['SOURCE', 'READY']);
  });

  it.each(['rulesHash', 'requirementsHash'] as const)(
    'removes retryable candidates when %s changes',
    async (key) => {
      await candidate('OBSOLETE', { phase: 'ready', [key]: 'old' });
      expect((await cleanup(true)).candidates[0]).toMatchObject({
        action: 'remove',
        reason: 'obsolete-inputs',
        removed: true,
      });
    },
  );

  it('reclaims committed candidates while keeping failed postprocessing and audit diagnostics', async () => {
    const { row, path } = await candidate(
      'PUBLISHED',
      { phase: 'published', publishedRevision: 8 },
      'done',
    );
    row.stage = 'postprocess_error';
    await writeFile(resolve(path, 'audit.json'), '{"findings":[{"status":"warn"}]}');
    expect((await cleanup(true)).candidates[0]).toMatchObject({
      reason: 'published',
      removed: true,
    });
    expect(row.stage).toBe('postprocess_error');
    expect(row.summary).toMatchObject({
      phase: 'published',
      audit: { findings: [{ status: 'warn' }] },
      cleanup: { state: 'complete' },
    });
  });

  it('does not delete when the receipt conflicts or a directory is an alias', async () => {
    await candidate('UNCERTAIN', { phase: 'ready', publishedRevision: 8 });
    const { path } = await candidate('ALIAS');
    await rm(path, { recursive: true });
    await symlink(directory, path);
    const result = await cleanup(true);
    expect(result.candidates.map((entry) => entry.reason)).toEqual([
      'unverified-receipt',
      'unverified-directory',
    ]);
    expect(database.maintenanceRun.update).not.toHaveBeenCalled();
  });

  it('retries a recorded interrupted cleanup and preserves its original target', async () => {
    const { row } = await candidate('PENDING', {
      phase: 'abandoned',
      cleanup: { state: 'pending', reason: 'failed-or-interrupted', at: '2026-10-21T00:00:00Z' },
    });
    expect((await cleanup(true)).candidates[0]).toMatchObject({ removed: true });
    expect(row.summary).toMatchObject({
      timestamp: '2026-10-21T00:00:00Z',
      cleanup: { state: 'complete' },
    });
  });
});
