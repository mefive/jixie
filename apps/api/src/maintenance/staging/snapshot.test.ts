import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStagingSnapshot, schemaHash } from './snapshot.js';
import { freezeTableChanges } from './changes.js';
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
      expect(schemaHash(candidate)).toBe(schemaHash(formal));
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
