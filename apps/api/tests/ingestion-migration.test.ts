import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, cp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const migration = '20261101090000_ingestion';

it('replaces old coordination tables while retaining auth and business rows until explicit rebuild', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-ingestion-migration-'));
  try {
    const schema = join(directory, 'schema.prisma');
    const migrations = join(directory, 'migrations');
    const filename = join(directory, 'test.db');
    await mkdir(migrations);
    await writeFile(schema, await readFile(new URL('../prisma/schema.prisma', import.meta.url)));
    await cp(
      new URL('../prisma/migrations/migration_lock.toml', import.meta.url),
      join(migrations, 'migration_lock.toml'),
    );
    for (const entry of await readdir(new URL('../prisma/migrations/', import.meta.url), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && entry.name < migration) {
        await cp(
          new URL(`../prisma/migrations/${entry.name}`, import.meta.url),
          join(migrations, entry.name),
          { recursive: true },
        );
      }
    }
    const deploy = () =>
      execute(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
        {
          cwd: directory,
          env: { ...process.env, DATABASE_URL: `file:${filename}` },
          timeout: 60_000,
        },
      );
    const initialize = new DatabaseSync(filename);
    initialize.exec('PRAGMA user_version=0');
    initialize.close();
    await deploy();
    const before = new DatabaseSync(filename);
    before
      .prepare('INSERT INTO User (id,email,name,status) VALUES (?,?,?,?)')
      .run('user', 'keep@example.test', 'Keep', 'active');
    before
      .prepare('INSERT INTO Daily (tsCode,tradeDate,close) VALUES (?,?,?)')
      .run('600000.SH', '20261030', 10);
    before.close();
    await cp(
      new URL(`../prisma/migrations/${migration}`, import.meta.url),
      join(migrations, migration),
      { recursive: true },
    );
    await deploy();
    const after = new DatabaseSync(filename, { readOnly: true });
    try {
      const tables = after
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(
        expect.arrayContaining([
          'IngestionRun',
          'IngestionBatch',
          'IngestionIssue',
          'IngestionSelection',
        ]),
      );
      for (const table of [
        'MaintenanceRun',
        'DataSyncRun',
        'DatasetSyncState',
        'DatasetSyncPartition',
        'EtfSyncSlice',
        'MarketDownloadList',
        'EtfLatestSize',
      ]) {
        expect(tables).not.toContain(table);
      }
      expect(after.prepare('SELECT id,email,name,status FROM User').all()).toEqual([
        { id: 'user', email: 'keep@example.test', name: 'Keep', status: 'active' },
      ]);
      expect(after.prepare('SELECT count(*) AS count FROM Daily').get()?.count).toBe(1);
    } finally {
      after.close();
    }
    await deploy();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
