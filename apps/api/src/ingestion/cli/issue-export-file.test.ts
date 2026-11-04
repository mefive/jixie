import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIssueExportFile } from './issue-export-file.js';
import type { DiagnosticBundle } from '../issue-export-schema.js';

const bundle: DiagnosticBundle = {
  format: 'jixie-ingestion-diagnostics',
  version: 1,
  manifest: {
    exportedAt: '2026-11-04T00:00:00Z',
    snapshotConsistency: 'single_transaction',
    code: { commit: 'test', sourceDirty: false },
    codeIdentityScope: 'exporting_workspace_not_historical_attempts',
    schemaFingerprint: 'test',
    schemaFingerprintScope: 'exported_tables_and_applied_migrations',
    migrations: { available: false, applied: [] },
    marketRevision: null,
    redacted: true,
    valueSerialization: {
      dateTime: 'ISO_8601_from_Prisma',
      sqlLiteralsRequireStorageVerification: true,
    },
  },
  run: {},
  selection: {},
  counts: {},
  items: [],
  historicalIssues: [],
  tableSchemas: [],
  limitations: [],
};

it('publishes private JSON exclusively and cleans its temporary directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-diagnostic-file-'));
  try {
    const output = join(directory, 'diagnostics.json');
    expect(await writeIssueExportFile(output, bundle)).toBe(output);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(bundle);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['diagnostics.json']);
    await expect(writeIssueExportFile(output, bundle)).rejects.toMatchObject({
      reason: 'export_file_exists',
    });
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(bundle);
    expect(await readdir(directory)).toEqual(['diagnostics.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('preserves existing evidence and removes temporary files after a publication failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-diagnostic-file-'));
  try {
    const output = join(directory, 'existing.json');
    await writeFile(output, 'original evidence');
    await expect(writeIssueExportFile(output, bundle)).rejects.toMatchObject({
      reason: 'export_file_exists',
    });
    expect(await readFile(output, 'utf8')).toBe('original evidence');
    expect(await readdir(directory)).toEqual(['existing.json']);
    await expect(
      writeIssueExportFile(join(directory, 'missing', 'out.json'), bundle),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toEqual(['existing.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('refuses database and sidecar paths even when a sidecar does not exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-diagnostic-file-'));
  try {
    const database = join(directory, 'dev.db');
    await writeFile(database, 'database bytes');
    for (const filename of [
      database,
      `${database}-wal`,
      `${database}-shm`,
      `${database}-journal`,
    ]) {
      await expect(writeIssueExportFile(filename, bundle, database)).rejects.toMatchObject({
        reason: 'export_path_is_database',
      });
    }
    expect(await readFile(database, 'utf8')).toBe('database bytes');
    expect(await readdir(directory)).toEqual(['dev.db']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
