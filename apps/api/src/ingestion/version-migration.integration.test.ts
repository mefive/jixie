import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections, ingestionSource, ingestionTime } from '../../tests/ingestion-source.js';
import { ingestCandidate } from './replica.js';
import { candidateFilename } from './replica-files.js';

const execute = promisify(execFile);
const api = fileURLToPath(new URL('../../', import.meta.url));
const scripts = join(api, 'scripts');
const cli = join(api, 'src', 'ingestion', 'cli', 'data.ts');

it('converts reviewed legacy data, retains later application writes, restores and accepts by the original Run ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jixie-legacy-cutover-'));
  try {
    const runId = await withSyncDatabase(async (db, directory) => {
      await emptySelections(db);
      const run = await ingestCandidate(
        {
          targetDate: '19910104',
          clock: () => ingestionTime,
          source: ingestionSource(),
          onLog: () => {},
        },
        true,
      );
      expect(run.phase).toBe('awaiting_publish');
      await db.user.create({ data: { id: 'later-user', email: 'later@example.test' } });
      for (const [src, dest] of [
        [join(directory, 'test.db'), 'legacy.db'],
        [candidateFilename(run.runId), 'legacy-candidate.db'],
      ]) {
        // 来源均在本用例的临时目录；允许 SQLite 为已关闭的 WAL 库建立共享内存文件。
        // Both sources are isolated fixtures; SQLite may need a shared-memory file for a closed WAL database.
        await execute('sqlite3', [src, '.backup ' + dest], { cwd: root });
      }
      return run.runId;
    });
    const layout = join(root, 'converted');
    await execute(process.execPath, [
      join(scripts, 'convert-market-storage.mjs'),
      join(root, 'legacy.db'),
      layout,
      '--candidate',
      join(root, 'legacy-candidate.db'),
      '--apply',
    ]);
    const backupDir = join(root, 'backups');
    await execute(process.execPath, [join(scripts, 'backup-db.mjs')], {
      env: {
        ...process.env,
        JIXIE_DB_PATH: join(layout, 'legacy.db'),
        JIXIE_BACKUP_DIR: backupDir,
      },
    });
    const [bundle] = await readdir(backupDir);
    const restored = join(root, 'restored');
    await execute(process.execPath, [
      join(scripts, 'restore-market-backup.mjs'),
      join(backupDir, bundle),
      restored,
      '--apply',
    ]);
    const file = join(restored, 'legacy.db');
    const invoke = async (args: string[]) => {
      const result = await execute(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', cli, ...args],
        { cwd: api, env: { ...process.env, DATABASE_URL: 'file:' + file } },
      );
      return JSON.parse(result.stdout);
    };
    const review = await invoke(['runs', 'inspect', runId]);
    expect(review).toMatchObject({ phase: 'awaiting_publish', pending: 0 });
    await expect(
      invoke(['runs', 'accept', runId, '--expect-candidate', 'f'.repeat(64)]),
    ).rejects.toThrow();
    expect(
      await invoke(['runs', 'accept', runId, '--expect-candidate', review.candidateVersion]),
    ).toMatchObject({ mode: 'published', runId });
    const app = new DatabaseSync(file, { readOnly: true });
    try {
      expect(app.prepare("SELECT count(*) AS n FROM User WHERE id='later-user'").get()?.n).toBe(1);
      expect(
        app.prepare("SELECT name FROM sqlite_schema WHERE name='Daily'").get(),
      ).toBeUndefined();
      const pointer = app
        .prepare("SELECT currentVersionId FROM MarketPublication WHERE key='global'")
        .get();
      expect(pointer?.currentVersionId).toBe(runId);
      const market = new DatabaseSync(
        join(dirname(file), 'market', 'versions', runId, 'market.db'),
        { readOnly: true },
      );
      try {
        expect(market.prepare('SELECT count(*) AS n FROM Daily').get()?.n).toBeGreaterThan(0);
        expect(
          market
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name IN ('User','Session','IngestionReplicaChange')",
            )
            .get(),
        ).toBeUndefined();
      } finally {
        market.close();
      }
    } finally {
      app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
