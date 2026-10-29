import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const migration = '20261028160000_minimal_sync';

/** 旧 schema 在 Prisma 生成客户端之外读取。 / Inspect legacy schema without a migration-sensitive Prisma Client. */
function hasTable(database, name) {
  return Boolean(
    database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),
  );
}

async function identity(filename) {
  const database = await realpath(filename);
  const stat = await lstat(database);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Invalid database file');

  return { database, device: stat.dev, inode: stat.ino };
}

async function readTransfer(filename, databaseFile) {
  const stat = await lstat(filename);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    'Unsafe transfer file',
  );
  const captured = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(captured.migration, migration);
  const target = await identity(databaseFile);
  for (const key of ['database', 'device', 'inode']) {
    assert.equal(captured[key], target[key], 'Transfer belongs to a different database');
  }
  assert.ok(Number.isSafeInteger(captured.revision) && captured.revision >= 0);
  assert.ok(Array.isArray(captured.dividends));
  const seen = new Set();
  for (const row of captured.dividends) {
    assert.equal(typeof row.id, 'string');
    assert.ok(!seen.has(row.id), 'Duplicate transfer identity');
    seen.add(row.id);
    assert.equal(typeof row.availabilityQuality, 'string');
    assert.ok(
      row.observedAt === null ||
        (typeof row.observedAt === 'string' && Number.isFinite(new Date(row.observedAt).getTime())),
      'Invalid capture date',
    );
  }

  return captured;
}

/**
 * 排空并停服后只导出必要业务时间；重复部署不得覆盖尚未恢复的文件。
 *
 * Export only required business timestamps after draining; never overwrite a pending transfer.
 */
export async function exportDividendCaptures(
  databaseFile,
  transferFile = `${databaseFile}.minimal-sync.json`,
) {
  if (existsSync(transferFile)) {
    await readTransfer(transferFile, databaseFile);
    return resolve(transferFile);
  }
  if (!existsSync(databaseFile)) {
    return null;
  }
  const target = await identity(databaseFile);
  const database = new DatabaseSync(target.database, { readOnly: true });
  try {
    const hasEvidence = hasTable(database, 'MarketRecordEvidence');
    if (!hasEvidence && !hasTable(database, 'MaintenanceState')) {
      return null;
    }
    const evidence = new Map(
      hasEvidence
        ? database
            .prepare(
              'SELECT businessKey, firstObservedAt, availabilityQuality FROM MarketRecordEvidence WHERE tableName = ?',
            )
            .all('Dividend')
            .map((row) => [row.businessKey, row])
        : [],
    );
    const dividends = database
      .prepare('SELECT id FROM Dividend ORDER BY id')
      .all()
      .map(({ id }) => {
        const previous = evidence.get(JSON.stringify([id]));
        const date = previous
          ? new Date(
              typeof previous.firstObservedAt === 'bigint'
                ? Number(previous.firstObservedAt)
                : previous.firstObservedAt,
            )
          : null;
        assert.ok(!date || Number.isFinite(date.getTime()), 'Invalid legacy capture date');
        return {
          id,
          observedAt: date?.toISOString() ?? null,
          availabilityQuality: previous?.availabilityQuality ?? 'unknown',
        };
      });
    const current = hasTable(database, 'MarketDataState')
      ? database.prepare("SELECT revision FROM MarketDataState WHERE key = 'global'").get()
      : null;
    const legacy =
      !current && hasTable(database, 'MaintenanceState')
        ? database
            .prepare("SELECT dataRevision AS revision FROM MaintenanceState WHERE key = 'global'")
            .get()
        : null;
    const revision = Number(current?.revision ?? legacy?.revision ?? 0);
    assert.ok(Number.isSafeInteger(revision) && revision >= 0);
    await writeFile(transferFile, JSON.stringify({ migration, ...target, revision, dividends }), {
      flag: 'wx',
      mode: 0o600,
    });

    return resolve(transferFile);
  } finally {
    database.close();
  }
}

/**
 * schema 升级后先恢复业务时间和覆盖，再允许启动 API；失败保留恢复文件。
 *
 * Restore business time and coverage before API startup; failures retain the recovery file.
 */
export async function restoreDividendCaptures(
  databaseFile,
  transferFile = `${databaseFile}.minimal-sync.json`,
) {
  const captured = await readTransfer(transferFile, databaseFile);
  const transferIdentity = await lstat(transferFile);
  const inspection = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    assert.ok(
      !hasTable(inspection, 'MarketRecordEvidence'),
      'Apply the generated schema migration before restoration',
    );
    assert.ok(
      inspection
        .prepare(
          'SELECT migration_name FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
        )
        .get(migration),
      'Required migration is incomplete',
    );
    const ids = inspection
      .prepare('SELECT id FROM Dividend ORDER BY id')
      .all()
      .map((row) => row.id);
    assert.deepEqual(
      ids,
      captured.dividends.map((row) => row.id).sort(),
      'Dividend identities changed during the offline upgrade',
    );
  } finally {
    inspection.close();
  }
  const { createDatabase, withDatabase, closeDatabase } = await import('#infra/database/prisma.js');
  const { updateVerifiedCoverage } = await import('#market/synchronization/coverage.js');
  const { datasetScopes } = await import('#market/synchronization/scopes.js');
  const { DATASET_POLICIES } = await import('#market/synchronization/policies.js');
  const database = createDatabase(`file:${captured.database}`);
  try {
    await withDatabase(database, async () => {
      await database.$transaction(
        async (transaction) => {
          for (const row of captured.dividends) {
            const restored = await transaction.dividend.updateMany({
              where: { id: row.id },
              data: {
                observedAt: row.observedAt ? new Date(row.observedAt) : null,
                availabilityQuality: row.availabilityQuality,
              },
            });
            assert.equal(restored.count, 1);
          }
          const current = await transaction.marketDataState.findUnique({
            where: { key: 'global' },
          });
          await transaction.marketDataState.upsert({
            where: { key: 'global' },
            create: { key: 'global', revision: captured.revision },
            update: { revision: Math.max(current?.revision ?? 0, captured.revision) },
          });
        },
        { timeout: 120_000 },
      );
      for (const policy of DATASET_POLICIES) {
        const starts = new Map(
          (await datasetScopes(policy)).map((scope) => [scope.scope, scope.startDate]),
        );
        const states = await database.datasetSyncState.findMany({
          where: { dataset: policy.dataset },
        });
        for (const state of states) {
          await database.$transaction((transaction) =>
            updateVerifiedCoverage(
              transaction,
              state.dataset,
              state.scope,
              starts.get(state.scope) ?? policy.startDate,
            ),
          );
        }
      }
      const actual = await database.dividend.findMany({
        select: { id: true, observedAt: true, availabilityQuality: true },
        orderBy: { id: 'asc' },
      });
      assert.deepEqual(
        actual.map((row) => ({ ...row, observedAt: row.observedAt?.toISOString() ?? null })),
        captured.dividends,
      );
    });
  } finally {
    await closeDatabase(database);
  }
  const remaining = await lstat(transferFile);
  assert.ok(
    remaining.dev === transferIdentity.dev && remaining.ino === transferIdentity.ino,
    'Recovery file was replaced',
  );
  await unlink(transferFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, filename, extra] = process.argv.slice(2);
  if (!filename || extra || !['export', 'restore'].includes(command)) {
    console.error('Usage: upgrade-minimal-sync.mjs export|restore DATABASE_FILE');
    process.exitCode = 2;
  } else {
    try {
      if (command === 'export') {
        const transfer = await exportDividendCaptures(resolve(filename));
        if (transfer) {
          process.stdout.write(`${transfer}\n`);
        }
      } else {
        await restoreDividendCaptures(resolve(filename));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
