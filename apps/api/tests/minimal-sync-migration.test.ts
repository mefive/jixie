import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';
import { withDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { retireDatasets } from '#maintenance/retired-datasets.js';
import { synchronizeData } from '#maintenance/sync.js';
import { STOCK_CODE_CHANGES } from '#market/instruments/stock-identity.js';
import { legacyMarketTable } from './legacy-market-tables.js';

const migration = '20261028160000_minimal_sync';
const require = createRequire(import.meta.url);

it('upgrades offline, preserves dividend capture and saved user data, and resumes interrupted restoration', async () => {
  const directory = await mkdtemp('/tmp/jixie-minimal-sync-upgrade-');
  const filename = join(directory, 'upgrade.db');
  const url = `file:${filename}`;
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  const database = new prismaPackage.PrismaClient({ datasourceUrl: url });
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const env = { ...process.env, DATABASE_URL: url, NODE_OPTIONS: '' };
  const deploy = () =>
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema],
      { env, stdio: 'pipe' },
    );
  const command = (action: 'export' | 'restore', target = filename) =>
    execFileSync(process.execPath, [resolve('scripts/upgrade-minimal-sync.mjs'), action, target], {
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  const transfer = `${filename}.minimal-sync.json`;
  try {
    await writeFile(filename, '');
    await cp(resolve('prisma/schema.prisma'), schema);
    await mkdir(migrations);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name < migration || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();
    await database.$executeRaw`INSERT INTO Dividend (id, tsCode, endDate, annDate, exDate, divProc, cashDiv) VALUES ('known', '600000.SH', '20251231', '20260301', '20260601', '实施', 1.2)`;
    await database.$executeRaw`INSERT INTO Dividend (id, tsCode, endDate, annDate, exDate, divProc, cashDiv) VALUES ('unknown', '600001.SH', '20251231', '20260301', '20260601', '实施', 0.5)`;
    await legacyMarketTable(database, 'MarketRecordEvidence').createMany({
      data: [
        {
          tableName: 'Dividend',
          businessKey: '["known"]',
          dataset: 'dividends',
          fingerprint: 'legacy-current-value',
          fieldEvidence: {},
          availabilityQuality: 'latest_only',
          firstObservedAt: new Date('2026-06-02T02:00:00Z'),
          lastFetchedAt: new Date('2026-10-27T02:00:00Z'),
        },
      ],
    });
    await database.$executeRaw`INSERT INTO MaintenanceState (key, dataRevision, updatedAt) VALUES ('global', 99, 1)`;
    await database.marketDataState.create({ data: { key: 'global', revision: 17 } });
    await legacyMarketTable(database, 'DatasetSyncState').createMany({
      data: [
        {
          dataset: 'stock-prices',
          scope: 'all',
          historyStart: '20150101',
          backfillCursor: '20300101',
          plannedThrough: '20300101',
          policyVersion: 'sync-v1',
          verifiedThrough: '20300101',
          maxObservedDate: '20261027',
        },
      ],
    });
    await database.datasetSyncPartition.createMany({
      data: [
        {
          id: 'retained',
          dataset: 'stock-prices',
          scope: 'all',
          startDate: '20261027',
          endDate: '20261027',
          policyVersion: 'sync-v1',
          status: 'complete',
        },
        {
          id: 'retired',
          dataset: 'etf-shares',
          scope: 'all',
          startDate: '20261027',
          endDate: '20261027',
          policyVersion: 'sync-v1',
          status: 'error',
        },
      ],
    });
    await database.user.create({
      data: { id: 'owner', email: 'minimal-sync-upgrade@fixture.invalid' },
    });
    await database.factorReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        factor: 'saved',
        legacyStatus: 'done',
        freq: 'month',
        start: '20240101',
        end: '20241231',
        payload: '{"preserved":true}',
        factorCodeSnapshot: 'saved source',
      },
    });
    await database.factor.create({
      data: {
        id: 'saved',
        userId: 'owner',
        key: 'saved_v1',
        name: 'Saved version',
        code: 'saved source',
        status: 'published',
        approvedReportId: 'report',
      },
    });
    await database.agentConversation.create({
      data: {
        id: 'research',
        userId: 'owner',
        surface: 'research',
        researchDocument: {
          create: {
            id: 'research',
            userId: 'owner',
            cells: {
              create: {
                id: 'cell',
                position: 0,
                kind: 'python',
                source: 'print("saved document")',
                definitions: [],
                references: [],
              },
            },
          },
        },
      },
    });
    await database.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Saved strategy',
        config: { code: 'saved strategy source' },
      },
    });
    const saved = async () =>
      Promise.all([
        database.factor.findMany(),
        database.factorReport.findMany(),
        database.strategy.findMany(),
        database.researchDocument.findMany({ include: { cells: true } }),
      ]);
    const before = await saved();
    const unaffectedSchema = async () =>
      (
        await database.$queryRawUnsafe<
          Array<{ name: string; tbl_name: string; sql: string | null }>
        >('SELECT name, tbl_name, sql FROM sqlite_master ORDER BY name')
      ).filter(
        (row) =>
          ![
            '_prisma_migrations',
            'Dividend',
            'DatasetSyncState',
            'DatasetSyncPartition',
            'MarketRecordEvidence',
            'MaintenanceState',
            'MaintenanceCheckpoint',
            'MarketCalculationState',
          ].includes(row.tbl_name),
      );
    const schemaBefore = await unaffectedSchema();
    expect(command('export').trim()).toBe(transfer);
    const exported = await readFile(transfer, 'utf8');
    expect((await stat(transfer)).mode & 0o077).toBe(0);
    expect(command('export').trim()).toBe(transfer);
    expect(await readFile(transfer, 'utf8')).toBe(exported);
    const wrong = join(directory, 'wrong.db');
    await writeFile(wrong, '');
    await cp(transfer, `${wrong}.minimal-sync.json`);
    expect(() => command('export', wrong)).toThrow();
    await cp(resolve('prisma/migrations', migration), join(migrations, migration), {
      recursive: true,
    });
    deploy();
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name IN ('MarketRecordEvidence','MaintenanceCheckpoint','MaintenanceState','MarketCalculationState')`,
    ).toEqual([]);
    expect(command('export').trim()).toBe(transfer);
    expect(await readFile(transfer, 'utf8')).toBe(exported);
    await rename(transfer, `${transfer}.hold`);
    expect(() => command('restore')).toThrow();
    await rename(`${transfer}.hold`, transfer);
    // 恢复业务值后故意在覆盖重算失败，文件仍可用于幂等续传。
    // Fail coverage rebuilding after restoring values to exercise idempotent recovery.
    await database.marketDownloadList.create({ data: { assetType: 'index', codes: ['INVALID'] } });
    expect(() => command('restore')).toThrow();
    expect(await readFile(transfer, 'utf8')).toBe(exported);
    expect(
      (await database.dividend.findUniqueOrThrow({ where: { id: 'known' } })).observedAt,
    ).toEqual(new Date('2026-06-02T02:00:00Z'));
    await database.marketDownloadList.update({
      where: { assetType: 'index' },
      data: { codes: [] },
    });
    command('restore');
    await expect(readFile(transfer)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(command('export')).toBe('');
    expect(await saved()).toEqual(before);
    expect(await unaffectedSchema()).toEqual(schemaBefore);
    expect(await database.dividend.findMany({ orderBy: { id: 'asc' } })).toMatchObject([
      {
        id: 'known',
        cashDiv: 1.2,
        observedAt: new Date('2026-06-02T02:00:00Z'),
        availabilityQuality: 'latest_only',
      },
      { id: 'unknown', cashDiv: 0.5, observedAt: null, availabilityQuality: 'unknown' },
    ]);
    expect(
      (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
    ).toBe(17);
    expect(
      (
        await database.datasetSyncState.findUniqueOrThrow({
          where: { dataset_scope: { dataset: 'stock-prices', scope: 'all' } },
        })
      ).verifiedThrough,
    ).toBeNull();
    await withDatabase(database, async () => {
      await expect(retireDatasets()).rejects.toThrow();
      await withMaintenanceLock(retireDatasets);
      await withMaintenanceLock(retireDatasets);
    });
    expect((await database.datasetSyncPartition.findMany()).map((row) => row.id)).toEqual([
      'retained',
    ]);
    await withDatabase(database, async () => {
      const result = await synchronizeData({
        targetDate: '20261027',
        startedAt: new Date('2026-10-28T10:00:00Z'),
        signal: AbortSignal.abort(),
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              throw new Error('No source calls permitted in interrupted fixture');
            },
          },
        },
      });
      expect(result.partitions).toBe(0);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(18 + STOCK_CODE_CHANGES.length);
      expect(await database.datasetSyncPartition.count({ where: { status: 'complete' } })).toBe(0);
      expect(
        await database.datasetSyncPartition.findUniqueOrThrow({ where: { id: 'retained' } }),
      ).toMatchObject({ status: 'superseded' });
    });
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    expect(await database.$queryRaw`PRAGMA integrity_check`).toEqual([{ integrity_check: 'ok' }]);
  } finally {
    await database.$disconnect();
    if (oldUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = oldUrl;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it('skips new databases, falls back to the legacy revision only when needed, and rejects restoration before migration', async () => {
  const directory = await mkdtemp('/tmp/jixie-minimal-sync-export-');
  const filename = join(directory, 'export.db');
  const command = (action: 'export' | 'restore') =>
    execFileSync(
      process.execPath,
      [resolve('scripts/upgrade-minimal-sync.mjs'), action, filename],
      { env: { ...process.env, NODE_OPTIONS: '' }, stdio: 'pipe', encoding: 'utf8' },
    );
  try {
    expect(command('export')).toBe('');
    const raw = new DatabaseSync(filename);
    try {
      raw.exec(
        "CREATE TABLE Dividend (id TEXT PRIMARY KEY); CREATE TABLE MaintenanceState (key TEXT PRIMARY KEY, dataRevision INTEGER); INSERT INTO MaintenanceState VALUES ('global', 9);",
      );
      expect(command('export').trim()).toBe(`${filename}.minimal-sync.json`);
      const saved = JSON.parse(await readFile(`${filename}.minimal-sync.json`, 'utf8'));
      expect(saved).toMatchObject({ revision: 9, dividends: [] });
      expect(() => command('restore')).toThrow();
      expect(await readFile(`${filename}.minimal-sync.json`, 'utf8')).toBe(JSON.stringify(saved));
    } finally {
      raw.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
