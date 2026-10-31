import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { upgradeSyncProofs } from '../../apps/api/scripts/upgrade-sync-proofs.mjs';

const migration = readFileSync(
  new URL(
    '../../apps/api/prisma/migrations/20261031010000_remove_sync_policy_versions/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

/**
 * 仅创建旧控制表和不可变业务样本；不连接开发库。
 *
 * Create legacy control tables and immutable samples without touching the working database.
 */
function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'jixie-sync-proofs-'));
  const filename = join(directory, 'fixture.db');
  const database = new DatabaseSync(filename);
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.exec(`
    CREATE TABLE DatasetSyncPartition (
      id TEXT PRIMARY KEY, dataset TEXT NOT NULL, scope TEXT NOT NULL,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL, status TEXT NOT NULL,
      policyVersion TEXT NOT NULL, gaps JSONB, error TEXT, lastRunId TEXT,
      lastAttemptAt DATETIME, checkedAt DATETIME
    );
    CREATE TABLE DatasetSyncState (
      dataset TEXT NOT NULL, scope TEXT NOT NULL, verifiedThrough TEXT,
      maxObservedDate TEXT, lastCheckedAt DATETIME, lastBackfillAt DATETIME,
      PRIMARY KEY (dataset, scope)
    );
    CREATE TABLE MarketDataState (
      key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updatedAt DATETIME NOT NULL
    );
    INSERT INTO MarketDataState VALUES ('global', 7, 123);
    CREATE TABLE BusinessSample (
      id TEXT PRIMARY KEY, value REAL, fingerprint TEXT, observedAt DATETIME
    );
    INSERT INTO BusinessSample VALUES ('preserved', 2.2002, 'original-fingerprint', 123);
  `);

  return { filename, database };
}

function seed(database, dataset, status = 'complete', version = 'sync-v2') {
  database
    .prepare(
      `
    INSERT INTO DatasetSyncPartition
      (id, dataset, scope, startDate, endDate, status, policyVersion, error, checkedAt)
    VALUES (?, ?, 'all', '20260918', '20260918', ?, ?, 'Original evidence', 123)
  `,
    )
    .run(dataset, dataset, status, version);
  database
    .prepare(
      `
    INSERT INTO DatasetSyncState (dataset, scope, verifiedThrough, maxObservedDate)
    VALUES (?, 'all', '20260918', '20260918')
  `,
    )
    .run(dataset);
}

function readRows(database, query) {
  return database
    .prepare(query)
    .all()
    .map((row) => ({ ...row }));
}

test('preserves values and evidence, revokes affected proofs once, and resumes across column removal', (context) => {
  const { database, filename } = fixture(context);
  const affected = [
    'stock-names',
    'stock-prices',
    'stock-adjustments',
    'stock-valuations',
    'stock-limits',
    'index-weights',
    'financial-statements',
    'financial-indicators',
    'dividends',
  ];
  for (const dataset of affected) {
    seed(database, dataset);
  }
  for (const dataset of [
    'calendar',
    'stock-master',
    'etf-master',
    'etf-prices',
    'etf-adjustments',
    'index-prices',
    'index-valuations',
  ]) {
    seed(database, dataset);
  }
  const values = database.prepare('SELECT * FROM BusinessSample').all();
  const before = readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id');
  assert.equal(upgradeSyncProofs(filename), affected.length * 2);
  assert.deepEqual(readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id'), before);

  assert.equal(upgradeSyncProofs(filename, true), affected.length * 2);
  assert.equal(upgradeSyncProofs(filename, true), 0);
  assert.equal(database.prepare('SELECT revision FROM MarketDataState').get().revision, 8);
  const after = readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id');
  assert.deepEqual(
    after,
    before.map((row) => (affected.includes(row.dataset) ? { ...row, status: 'superseded' } : row)),
  );
  for (const row of database.prepare('SELECT * FROM DatasetSyncState').all()) {
    assert.equal(row.verifiedThrough, affected.includes(row.dataset) ? null : '20260918');
    assert.equal(row.maxObservedDate, '20260918');
  }

  database.exec(migration);
  const migrated = readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id');
  assert.deepEqual(
    migrated,
    after.map(({ policyVersion: _version, ...row }) => row),
  );
  database.exec(
    "UPDATE DatasetSyncPartition SET status = 'complete' WHERE dataset = 'stock-prices'",
  );
  database.exec(
    "UPDATE DatasetSyncState SET verifiedThrough = '20260918' WHERE dataset = 'stock-prices'",
  );
  assert.equal(upgradeSyncProofs(filename, true), 0);
  assert.equal(
    database.prepare("SELECT status FROM DatasetSyncPartition WHERE dataset = 'stock-prices'").get()
      .status,
    'complete',
  );
  assert.deepEqual(database.prepare('SELECT * FROM BusinessSample').all(), values);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('older protocol proofs cannot retain dependent eligibility after version removal', (context) => {
  const { database, filename } = fixture(context);
  seed(database, 'calendar', 'complete', 'sync-v1');
  seed(database, 'index-prices');
  seed(database, 'etf-adjustments', 'unavailable');
  seed(database, 'dividends', 'error', 'sync-v1');
  const failure = database
    .prepare("SELECT * FROM DatasetSyncPartition WHERE dataset = 'dividends'")
    .get();

  assert.equal(upgradeSyncProofs(filename, true), 7);
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM DatasetSyncState WHERE verifiedThrough IS NOT NULL')
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM DatasetSyncPartition WHERE status = 'superseded'")
      .get().count,
    3,
  );
  assert.deepEqual(
    database.prepare("SELECT * FROM DatasetSyncPartition WHERE dataset = 'dividends'").get(),
    failure,
  );
  assert.equal(upgradeSyncProofs(filename, true), 0);
});

test('a failed upgrade rolls back all proof, coverage and revision changes and can be retried', (context) => {
  const { database, filename } = fixture(context);
  seed(database, 'stock-prices');
  database.exec(`
    CREATE TRIGGER fail_coverage BEFORE UPDATE ON DatasetSyncState
    BEGIN SELECT RAISE(ABORT, 'controlled interruption'); END;
  `);

  assert.throws(() => upgradeSyncProofs(filename, true), /controlled interruption/);
  assert.equal(
    database.prepare('SELECT status FROM DatasetSyncPartition').get().status,
    'complete',
  );
  assert.equal(
    database.prepare('SELECT verifiedThrough FROM DatasetSyncState').get().verifiedThrough,
    '20260918',
  );
  assert.equal(database.prepare('SELECT revision FROM MarketDataState').get().revision, 7);

  database.exec('DROP TRIGGER fail_coverage');
  assert.equal(upgradeSyncProofs(filename, true), 2);
});

test('preserves pending, partial and error attempts while revoking an affected source boundary', (context) => {
  const { database, filename } = fixture(context);
  seed(database, 'stock-prices', 'error');
  seed(database, 'dividends', 'partial');
  seed(database, 'stock-names', 'pending');
  seed(database, 'index-weights', 'unavailable');
  const before = readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id');

  assert.equal(upgradeSyncProofs(filename, true), 5);
  assert.deepEqual(
    readRows(database, 'SELECT * FROM DatasetSyncPartition ORDER BY id'),
    before.map((row) => (row.status === 'unavailable' ? { ...row, status: 'superseded' } : row)),
  );
  assert.equal(upgradeSyncProofs(filename, true), 0);
});

test('new databases and databases without the legacy column need no conversion', (context) => {
  const { database, filename } = fixture(context);
  assert.equal(upgradeSyncProofs(join(filename, 'missing.db'), true), 0);
  database.exec(migration);
  assert.equal(upgradeSyncProofs(filename, true), 0);
  assert.equal(database.prepare('SELECT revision FROM MarketDataState').get().revision, 7);
});
