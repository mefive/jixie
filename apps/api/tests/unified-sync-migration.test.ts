import { execFile } from 'node:child_process';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rm, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { closeDatabase, createDatabase, withDatabase } from '#infra/database/prisma.js';
import { synchronizeData } from '#maintenance/sync.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const migration = '20261023154111_unified_data_sync';
const prismaDirectory = fileURLToPath(new URL('../prisma/', import.meta.url));
const newTables = [
  'DataSyncRun',
  'DatasetSyncState',
  'DatasetSyncPartition',
  'MarketCalculationState',
  'MarketDataState',
  'MarketRecordEvidence',
  'FinaIndicatorVersion',
  'FutureMarketRevision',
];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: string | null;
}
interface ForeignKey {
  from: string;
  table: string;
  to: string;
}

/**
 * 填入真实旧 schema 允许的非空值并递归建立必需外键，只验证迁移保真，不冒充策略输入。
 *
 * Seed non-null legacy fields and required foreign keys for migration fidelity, not strategy input.
 */
function seedLegacy(database: DatabaseSync) {
  const seeded = new Map<string, Record<string, SQLInputValue>>();
  const seed = (table: string, overrides: Record<string, SQLInputValue> = {}) => {
    const previous = seeded.get(table);
    if (previous) {
      return previous;
    }
    const columns = database
      .prepare(`PRAGMA table_info(${quote(table)})`)
      .all() as unknown as Column[];
    const foreignKeys = database
      .prepare(`PRAGMA foreign_key_list(${quote(table)})`)
      .all() as unknown as ForeignKey[];
    const values: Record<string, SQLInputValue> = { ...overrides };
    for (const column of columns) {
      if (
        Object.hasOwn(values, column.name) ||
        column.dflt_value !== null ||
        (!column.notnull && !column.pk)
      ) {
        continue;
      }
      const foreign = foreignKeys.find((key) => key.from === column.name);
      if (foreign) {
        const parent = seed(foreign.table);
        values[column.name] = parent[foreign.to];
      } else if (/INT|REAL|FLOAT|NUMERIC/.test(column.type)) {
        values[column.name] = column.name.toLowerCase().includes('count') ? 0 : 12.5;
      } else if (/JSON/.test(column.type)) {
        values[column.name] = '{}';
      } else if (/DATE/.test(column.type)) {
        values[column.name] = '2026-09-15T00:00:00.000Z';
      } else {
        values[column.name] = column.name.toLowerCase().includes('date')
          ? '20260915'
          : `fixture-${table}-${column.name}`;
      }
    }
    const names = Object.keys(values);
    database
      .prepare(
        `INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      )
      .run(...names.map((name) => values[name]));
    seeded.set(table, values);
    return values;
  };
  for (const table of [
    'IndexIndicator',
    'MarketIndicator',
    'Moneyflow',
    'FactorWeatherPin',
    'BacktestReport',
    'FactorReport',
    'ResearchDocument',
    'SignalRun',
    'SignalExecution',
    'StrategyAccountSnapshot',
    'FutureMarketPublication',
    'FinaIndicator',
  ]) {
    seed(table);
  }
  seed('MaintenanceState', { key: 'global', dataRevision: 17 });
  database
    .prepare('INSERT INTO Moneyflow (tsCode,tradeDate,netMain,netTotal) VALUES (?,?,?,?)')
    .run('zero-fixture', '20260916', 0, null);
  expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

async function deploy(directory: string) {
  const started = performance.now();
  await execute(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(directory, 'schema.prisma'),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        DATABASE_URL: `file:${join(directory, 'test.db')}`,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      timeout: 30_000,
    },
  );
  return performance.now() - started;
}

it.each(['upgrade', 'empty'] as const)(
  'applies the approved unified migration to %s and retains legacy data',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'jixie-sync-migration-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    try {
      await cp(join(prismaDirectory, 'migrations'), join(directory, 'migrations'), {
        recursive: true,
      });
      // 本用例只验证统一同步迁移；后续退役迁移由各自用例覆盖。
      // This fixture isolates unified synchronization; later retirements have their own tests.
      for (const name of await readdir(join(directory, 'migrations'))) {
        if (name !== 'migration_lock.toml' && name > migration) {
          await rm(join(directory, 'migrations', name), { recursive: true });
        }
      }
      await writeFile(
        join(directory, 'schema.prisma'),
        await readFile(join(prismaDirectory, 'schema.prisma')),
      );
      const empty = new DatabaseSync(join(directory, 'test.db'));
      empty.exec('PRAGMA user_version=0');
      empty.close();
      let snapshots: Array<{
        table: string;
        columns: string[];
        columnDefinitions: Column[];
        foreignKeys: unknown[];
        rows: unknown[];
        indices: unknown[];
        indexColumns: unknown[];
      }> = [];
      let bytesBefore = (await stat(join(directory, 'test.db'))).size;
      if (mode === 'upgrade') {
        await rm(join(directory, 'migrations', migration), { recursive: true });
        await deploy(directory);
        const legacy = new DatabaseSync(join(directory, 'test.db'));
        try {
          seedLegacy(legacy);
          const tables = legacy
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name",
            )
            .all() as { name: string }[];
          snapshots = tables.map(({ name: table }) => {
            const columnDefinitions = legacy
              .prepare(`PRAGMA table_info(${quote(table)})`)
              .all() as unknown as Column[];
            const columns = columnDefinitions.map((column) => column.name);
            const indices = legacy.prepare(`PRAGMA index_list(${quote(table)})`).all();

            return {
              table,
              columns,
              columnDefinitions,
              foreignKeys: legacy.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all(),
              rows: legacy
                .prepare(
                  `SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY rowid`,
                )
                .all(),
              indices,
              indexColumns: indices.map((index) =>
                legacy.prepare(`PRAGMA index_info(${quote(String(index.name))})`).all(),
              ),
            };
          });
        } finally {
          legacy.close();
        }
        bytesBefore = (await stat(join(directory, 'test.db'))).size;
        await cp(
          join(prismaDirectory, 'migrations', migration),
          join(directory, 'migrations', migration),
          { recursive: true },
        );
      }

      const durationMs = await deploy(directory);
      const bytesAfter = (await stat(join(directory, 'test.db'))).size;
      const database = new DatabaseSync(join(directory, 'test.db'));
      try {
        expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(database.prepare('PRAGMA integrity_check').get()).toMatchObject({
          integrity_check: 'ok',
        });
        expect(
          database
            .prepare(
              'SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL',
            )
            .get(),
        ).toMatchObject({ count: 98 });
        for (const snapshot of snapshots) {
          const columnsAfter = database
            .prepare(`PRAGMA table_info(${quote(snapshot.table)})`)
            .all() as unknown as Column[];
          const expectedColumns = snapshot.columnDefinitions.map((column) => ({
            ...column,
            notnull:
              ((snapshot.table === 'IndexIndicator' || snapshot.table === 'MarketIndicator') &&
                ['limitUpCount', 'limitDownCount'].includes(column.name)) ||
              (snapshot.table === 'Moneyflow' && column.name === 'netMain')
                ? 0
                : column.notnull,
          }));

          expect(
            columnsAfter
              .filter((column) => snapshot.columns.includes(column.name))
              .map(({ cid: _ordinal, ...definition }) => definition)
              .sort((left, right) => left.name.localeCompare(right.name)),
            snapshot.table,
          ).toEqual(
            expectedColumns
              .map(({ cid: _ordinal, ...definition }) => definition)
              .sort((left, right) => left.name.localeCompare(right.name)),
          );
          expect(
            columnsAfter
              .filter((column) => !snapshot.columns.includes(column.name))
              .map((column) => column.name),
            snapshot.table,
          ).toEqual(snapshot.table === 'FactorWeatherPin' ? ['dirtyFrom', 'inputRevision'] : []);
          expect(
            database.prepare(`PRAGMA foreign_key_list(${quote(snapshot.table)})`).all(),
            snapshot.table,
          ).toEqual(snapshot.foreignKeys);
          expect(
            database
              .prepare(
                `SELECT ${snapshot.columns.map(quote).join(',')} FROM ${quote(snapshot.table)} ORDER BY rowid`,
              )
              .all(),
            snapshot.table,
          ).toEqual(snapshot.rows);
          expect(
            database.prepare(`PRAGMA index_list(${quote(snapshot.table)})`).all(),
            snapshot.table,
          ).toEqual(snapshot.indices);
          expect(
            snapshot.indices.map((index) =>
              database
                .prepare(`PRAGMA index_info(${quote(String((index as { name: string }).name))})`)
                .all(),
            ),
            snapshot.table,
          ).toEqual(snapshot.indexColumns);
        }
        for (const table of newTables) {
          expect(
            database.prepare(`SELECT count(*) AS count FROM ${quote(table)}`).get(),
          ).toMatchObject({ count: 0 });
        }
        if (mode === 'upgrade') {
          expect(
            database.prepare('SELECT dirtyFrom,inputRevision FROM FactorWeatherPin').get(),
          ).toEqual({ dirtyFrom: null, inputRevision: null });
          for (const [table, field] of [
            ['IndexIndicator', 'limitUpCount'],
            ['IndexIndicator', 'limitDownCount'],
            ['MarketIndicator', 'limitUpCount'],
            ['MarketIndicator', 'limitDownCount'],
            ['Moneyflow', 'netMain'],
          ]) {
            expect(
              (
                database.prepare(`PRAGMA table_info(${quote(table)})`).all() as unknown as Column[]
              ).find((column) => column.name === field)?.notnull,
            ).toBe(0);
          }
        }
      } finally {
        database.close();
      }

      console.log(
        JSON.stringify({
          mode,
          durationMs,
          bytesBefore,
          bytesAfter,
          retainedTables: snapshots.length,
        }),
      );
      if (mode === 'upgrade') {
        const client = createDatabase(url);
        try {
          await withDatabase(client, async () => {
            const controller = new AbortController();
            controller.abort(new Error('Controlled bootstrap budget'));
            await synchronizeData({
              targetDate: '20260915',
              startedAt: new Date('2026-09-16T10:00:00Z'),
              signal: controller.signal,
              requirements: { etfCodes: [] },
              onLog: () => {},
              providers: {
                source: {
                  call: async () => {
                    throw new Error('No source calls permitted in bootstrap fixture');
                  },
                },
                treasury: { fetchRange: async () => [] },
                credit: { fetchRange: async () => [] },
                cpi: { loadSeries: async () => [] },
              },
            });
            expect(
              await client.marketDataState.findUniqueOrThrow({ where: { key: 'global' } }),
            ).toMatchObject({ revision: 17 });
            expect(await client.datasetSyncPartition.count({ where: { status: 'complete' } })).toBe(
              0,
            );
          });
        } finally {
          await closeDatabase(client);
        }
      }
    } finally {
      if (previousUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousUrl;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
