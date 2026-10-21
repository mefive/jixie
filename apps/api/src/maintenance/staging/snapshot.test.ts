import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStagingSnapshot, schemaHash } from './snapshot.js';
import { freezeTableChanges } from './changes.js';
import { TRACKED_KEYS, validateTracking } from './tracking.js';
import type { MarketTable } from './tables.js';

let directory: string;
let formal: DatabaseSync;
const table: MarketTable = {
  name: 'Daily',
  model: 'daily',
  keys: ['tsCode', 'tradeDate'],
  policy: 'mutable',
};
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-snapshot-'));
  formal = new DatabaseSync(resolve(directory, 'formal.db'));
  formal.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE Daily(tsCode TEXT, tradeDate TEXT, close REAL, PRIMARY KEY(tsCode, tradeDate));
    CREATE TABLE User(id TEXT PRIMARY KEY, secret TEXT);
    CREATE TABLE MaintenanceState(key TEXT PRIMARY KEY, dataRevision INTEGER);
    INSERT INTO MaintenanceState VALUES ('global',7);
    INSERT INTO User VALUES ('private','never-copy');
    INSERT INTO Daily VALUES ('000001.SZ','20261019',10),('000002.SZ','20261019',20);`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  formal.close();
  await rm(directory, { recursive: true, force: true });
});

describe('isolated market snapshots and frozen deltas', () => {
  it('reuses the schema, includes live WAL rows, and excludes user data', async () => {
    const snapshot = await createStagingSnapshot(
      resolve(directory, 'formal.db'),
      resolve(directory, 'candidate'),
      [table],
    );
    const candidate = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      expect(snapshot.baseRevision).toBe(7);
      expect(schemaHash(candidate, [table])).toBe(schemaHash(formal));
      expect(candidate.prepare('SELECT count(*) AS count FROM Daily').get()?.count).toBe(2);
      expect(candidate.prepare('SELECT count(*) AS count FROM User').get()?.count).toBe(0);
      expect((await stat(resolve(directory, 'candidate'))).mode & 0o777).toBe(0o700);
      expect((await stat(resolve(directory, 'candidate/candidate.db'))).mode & 0o777).toBe(0o600);
    } finally {
      candidate.close();
    }
  });

  it('freezes old values with updates so historical validity can be compared', async () => {
    await createStagingSnapshot(resolve(directory, 'formal.db'), resolve(directory, 'candidate'), [
      table,
    ]);
    const candidate = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      candidate.exec("UPDATE Daily SET close=11 WHERE tsCode='000001.SZ'");
      freezeTableChanges(formal, candidate, directory, table);
      const change = JSON.parse(await readFile(resolve(directory, 'Daily.changes'), 'utf8'));
      expect(change).toMatchObject({
        operation: 'update',
        before: { close: 10 },
        row: { close: 11 },
      });
    } finally {
      candidate.close();
    }
  });

  it('freezes only changed keys, preserving explicit deletions', async () => {
    await createStagingSnapshot(resolve(directory, 'formal.db'), resolve(directory, 'candidate'), [
      table,
    ]);
    const candidate = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      candidate.exec(
        "DELETE FROM Daily WHERE tsCode='000001.SZ'; INSERT INTO Daily VALUES ('000003.SZ','20261019',30)",
      );
      const changes = freezeTableChanges(formal, candidate, directory, table);
      expect(changes.count).toBe(2);
      const delta = (await readFile(resolve(directory, 'Daily.changes'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(delta.map((entry) => [entry.operation, entry.row.tsCode])).toEqual([
        ['delete', '000001.SZ'],
        ['insert', '000003.SZ'],
      ]);
      expect(formal.prepare('SELECT close FROM Daily WHERE tsCode=?').get('000001.SZ')?.close).toBe(
        10,
      );
      expect(() =>
        freezeTableChanges(formal, candidate, directory, { ...table, policy: 'immutable' }),
      ).toThrow('Immutable');
    } finally {
      candidate.close();
    }
  });
});

async function openCandidate() {
  await createStagingSnapshot(resolve(directory, 'formal.db'), resolve(directory, 'candidate'), [
    table,
  ]);

  return new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
}

function touchedCount(candidate: DatabaseSync): number {
  return Number(candidate.prepare(`SELECT count(*) AS count FROM ${TRACKED_KEYS}`).get()?.count);
}

describe('transactional touched-key capture', () => {
  it('starts empty, deduplicates rewrites, and collapses transient inserts to no change', async () => {
    const candidate = await openCandidate();
    try {
      expect(touchedCount(candidate)).toBe(0);
      candidate.exec(`BEGIN;
        DELETE FROM Daily WHERE tsCode='000001.SZ';
        INSERT INTO Daily VALUES ('000001.SZ','20261019',10);
        UPDATE Daily SET close=11 WHERE tsCode='000001.SZ';
        UPDATE Daily SET close=10 WHERE tsCode='000001.SZ';
        INSERT INTO Daily VALUES ('transient','20261019',1);
        DELETE FROM Daily WHERE tsCode='transient'; COMMIT;`);
      expect(touchedCount(candidate)).toBe(2);
      expect(freezeTableChanges(formal, candidate, directory, table).count).toBe(0);
    } finally {
      candidate.close();
    }
  });

  it('rolls back tracking with business writes and preserves earlier committed keys', async () => {
    const candidate = await openCandidate();
    try {
      candidate.exec("UPDATE Daily SET close=12 WHERE tsCode='000001.SZ'");
      candidate.exec("BEGIN; UPDATE Daily SET close=22 WHERE tsCode='000002.SZ'; ROLLBACK;");
      expect(touchedCount(candidate)).toBe(1);
      expect(freezeTableChanges(formal, candidate, directory, table).count).toBe(1);
      expect(
        candidate.prepare("SELECT close FROM Daily WHERE tsCode='000002.SZ'").get()?.close,
      ).toBe(20);
    } finally {
      candidate.close();
    }
  });

  it('captures both sides of a primary-key change and retains the original before value', async () => {
    const candidate = await openCandidate();
    try {
      candidate.exec("UPDATE Daily SET tsCode='000003.SZ', close=12 WHERE tsCode='000001.SZ'");
      expect(touchedCount(candidate)).toBe(2);
      expect(freezeTableChanges(formal, candidate, directory, table).count).toBe(2);
      const changes = (await readFile(resolve(directory, 'Daily.changes'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(changes).toEqual([
        { operation: 'delete', row: { tsCode: '000001.SZ', tradeDate: '20261019', close: 10 } },
        { operation: 'insert', row: { tsCode: '000003.SZ', tradeDate: '20261019', close: 12 } },
      ]);
    } finally {
      candidate.close();
    }
  });

  it('persists tracking across connections and repeated freezes without clearing earlier inputs', async () => {
    const first = await openCandidate();
    first.exec("UPDATE Daily SET close=11 WHERE tsCode='000001.SZ'");
    expect(freezeTableChanges(formal, first, directory, table).count).toBe(1);
    first.close();
    const second = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      second.exec(
        "UPDATE Daily SET close=12 WHERE tsCode='000001.SZ'; DELETE FROM Daily WHERE tsCode='000002.SZ'",
      );
      expect(freezeTableChanges(formal, second, directory, table).count).toBe(2);
      const changes = (await readFile(resolve(directory, 'Daily.changes'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(changes[0]).toMatchObject({ before: { close: 10 }, row: { close: 12 } });
      expect(changes[1].operation).toBe('delete');
    } finally {
      second.close();
    }
  });

  it('refuses tracking deletion and fails closed when a capture trigger is missing', async () => {
    const candidate = await openCandidate();
    try {
      candidate.exec("UPDATE Daily SET close=11 WHERE tsCode='000001.SZ'");
      expect(() => candidate.exec(`DELETE FROM ${TRACKED_KEYS}`)).toThrow('cannot be removed');
      candidate.exec('DROP TRIGGER _maintenance_track_Daily_UPDATE');
      expect(() => schemaHash(candidate, [table])).toThrow('tracking');
      expect(() => freezeTableChanges(formal, candidate, directory, table)).toThrow('tracking');
    } finally {
      candidate.close();
    }
  });

  it('rejects altered tracking definitions and does not hide unrelated schema changes', async () => {
    const candidate = await openCandidate();
    try {
      candidate.exec('CREATE TABLE _maintenance_unexpected(value TEXT)');
      expect(schemaHash(candidate, [table])).not.toBe(schemaHash(formal));
      candidate.exec(
        'DROP TRIGGER _maintenance_track_Daily_DELETE; CREATE TRIGGER _maintenance_track_Daily_DELETE AFTER DELETE ON Daily BEGIN SELECT 1; END',
      );
      expect(() => validateTracking(candidate, [table])).toThrow('tracking');
    } finally {
      candidate.close();
    }
  });

  it('uses primary-key lookups rather than selecting untouched historical rows', async () => {
    const candidate = await openCandidate();
    try {
      candidate.exec("UPDATE Daily SET close=11 WHERE tsCode='000001.SZ'");
      const formalReads = vi.spyOn(formal, 'prepare');
      const candidateReads = vi.spyOn(candidate, 'prepare');
      expect(freezeTableChanges(formal, candidate, directory, table).count).toBe(1);
      expect(formalReads.mock.calls.map(([sql]) => sql)).toEqual([
        'SELECT * FROM "Daily" WHERE "tsCode"=? AND "tradeDate"=?',
      ]);
      expect(candidateReads.mock.calls.some(([sql]) => sql.includes('FROM "Daily" ORDER BY'))).toBe(
        false,
      );
      expect(touchedCount(candidate)).toBe(1);
    } finally {
      candidate.close();
    }
  });

  it('keeps all copied tables on one baseline despite a concurrent formal WAL commit', async () => {
    formal.exec(
      "CREATE TABLE Extra(id TEXT PRIMARY KEY, value TEXT); INSERT INTO Extra VALUES ('old','old');",
    );
    const extra: MarketTable = { name: 'Extra', model: 'extra', keys: ['id'], policy: 'mutable' };
    vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
      if (String(message).startsWith('[maintenance] snapshot Daily:')) {
        formal.exec(
          "INSERT INTO Extra VALUES ('new','new'); UPDATE MaintenanceState SET dataRevision=8",
        );
      }
    });
    const snapshot = await createStagingSnapshot(
      resolve(directory, 'formal.db'),
      resolve(directory, 'candidate'),
      [table, extra],
    );
    const candidate = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      expect(snapshot.baseRevision).toBe(7);
      expect(candidate.prepare('SELECT count(*) AS count FROM Extra').get()?.count).toBe(1);
      expect(formal.prepare('SELECT count(*) AS count FROM Extra').get()?.count).toBe(2);
      expect(touchedCount(candidate)).toBe(0);
    } finally {
      candidate.close();
    }
  });
  it('preserves numeric composite keys and enforces versioned net-change policies', async () => {
    formal.exec(`CREATE TABLE Version(id TEXT, term REAL, tsCode TEXT, payload TEXT, PRIMARY KEY(id,term));
      INSERT INTO Version VALUES ('existing',0.25,'old','fixed');`);
    const version: MarketTable = {
      name: 'Version',
      model: 'version',
      keys: ['id', 'term'],
      policy: 'versioned',
    };
    await createStagingSnapshot(resolve(directory, 'formal.db'), resolve(directory, 'candidate'), [
      version,
    ]);
    const candidate = new DatabaseSync(resolve(directory, 'candidate/candidate.db'));
    try {
      candidate.exec(
        "UPDATE Version SET tsCode='canonical'; INSERT INTO Version VALUES ('new',1.5,'new','new')",
      );
      expect(freezeTableChanges(formal, candidate, directory, version).count).toBe(2);
      const delta = (await readFile(resolve(directory, 'Version.changes'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(delta[0]).toMatchObject({
        operation: 'update',
        before: { term: 0.25, tsCode: 'old' },
        row: { tsCode: 'canonical' },
      });

      candidate.exec("UPDATE Version SET payload='mutated' WHERE id='existing'");
      expect(() => freezeTableChanges(formal, candidate, directory, version)).toThrow(
        'payload mutated',
      );
      candidate.exec("DELETE FROM Version WHERE id='existing'");
      expect(() => freezeTableChanges(formal, candidate, directory, version)).toThrow(
        'version was deleted',
      );
    } finally {
      candidate.close();
    }
  });

  it('retains immutable records when writes restore identical values but rejects true changes', async () => {
    const candidate = await openCandidate();
    const immutable = { ...table, policy: 'immutable' as const };
    try {
      candidate.exec(
        "DELETE FROM Daily WHERE tsCode='000001.SZ'; INSERT INTO Daily VALUES ('000001.SZ','20261019',10)",
      );
      expect(freezeTableChanges(formal, candidate, directory, immutable).count).toBe(0);
      candidate.exec("UPDATE Daily SET close=11 WHERE tsCode='000001.SZ'");
      expect(() => freezeTableChanges(formal, candidate, directory, immutable)).toThrow(
        'Immutable',
      );
    } finally {
      candidate.close();
    }
  });
});
