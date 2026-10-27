import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';
import { withDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { retireDatasets } from '#maintenance/retired-datasets.js';
import { readDatasetCoverage } from '#maintenance/status.js';

const retirement = '20261027090000_remove_stock_flows';

it('drops only stock flow tables, preserves saved research, and retires only their maintenance records', async () => {
  const directory = await mkdtemp('/tmp/jixie-stock-flows-retirement-');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const database = new prismaPackage.PrismaClient({ datasourceUrl: databaseUrl });
  const deploy = () =>
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        schema,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
    );

  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name < retirement || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();

    await database.$executeRaw`INSERT INTO Moneyflow (tsCode,tradeDate,netMain,netTotal) VALUES ('600000.SH','20260915',5,7)`;
    await database.$executeRaw`INSERT INTO TopList (tsCode,tradeDate,netAmount) VALUES ('600000.SH','20260915',100)`;
    await database.user.create({ data: { id: 'owner', email: 'flows-upgrade@fixture.invalid' } });
    await database.daily.create({
      data: { tsCode: '600000.SH', tradeDate: '20260915', close: 10 },
    });
    await database.factorReport.create({
      data: {
        id: 'approved',
        userId: 'owner',
        factor: 'legacy',
        legacyStatus: 'done',
        freq: 'month',
        start: '20240101',
        end: '20241231',
        payload: '{"unchanged":true}',
        factorCodeSnapshot: 'export default defineFactor({compute: bar => bar.netMain});',
      },
    });
    await database.factor.createMany({
      data: [
        {
          id: 'legacy',
          userId: 'owner',
          key: 'legacy_v1',
          name: 'Saved flow source',
          status: 'published',
          approvedReportId: 'approved',
          code: 'export default defineFactor({compute: bar => bar.netMain});',
        },
        {
          id: 'independent',
          userId: 'owner',
          key: 'independent_v1',
          name: 'Value',
          status: 'published',
          code: 'export default defineFactor({compute: bar => bar.pb});',
        },
      ],
    });
    await database.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Saved strategy',
        config: { code: 'ctx.lhbNet("600000.SH")' },
      },
    });
    await database.agentConversation.create({
      data: {
        id: 'research',
        userId: 'owner',
        surface: 'research',
        researchDocument: { create: { id: 'research', userId: 'owner' } },
      },
    });
    await database.researchCell.create({
      data: {
        id: 'cell',
        documentId: 'research',
        kind: 'python',
        position: 0,
        definitions: [],
        references: [],
        source: 'data.equity_flows("600000.SH")',
      },
    });
    const datasets = ['stock-moneyflow', 'stock-toplist', 'stock-prices'];
    await database.datasetSyncState.createMany({
      data: datasets.map((dataset) => ({
        dataset,
        scope: 'all',
        historyStart: '20200101',
        backfillCursor: '20200101',
        policyVersion: 'sync-v1',
      })),
    });
    await database.datasetSyncPartition.createMany({
      data: datasets.map((dataset) => ({
        id: dataset,
        dataset,
        scope: 'all',
        startDate: '20260915',
        endDate: '20260915',
        status: 'error',
        policyVersion: 'sync-v1',
      })),
    });
    await database.marketRecordEvidence.createMany({
      data: ['Moneyflow', 'TopList', 'Daily'].map((tableName, index) => ({
        tableName,
        businessKey: '["fixture"]',
        dataset: datasets[index],
        fingerprint: 'unchanged',
        fieldEvidence: {},
        availabilityQuality: 'unknown',
        firstObservedAt: new Date('2026-09-16'),
        lastFetchedAt: new Date('2026-09-16'),
      })),
    });

    const snapshot = async () => {
      const schemaRows = await database.$queryRaw<
        Array<{ name: string; type: string; sql: string }>
      >`SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'Moneyflow%' AND name NOT LIKE 'TopList%' AND name NOT LIKE '_prisma_migrations%' ORDER BY name`;
      const rows = await Promise.all(
        schemaRows
          .filter((row) => row.type === 'table')
          .map(async (row) => ({
            table: row.name,
            records: await database.$queryRawUnsafe(
              `SELECT * FROM "${row.name.replaceAll('"', '""')}" ORDER BY rowid`,
            ),
          })),
      );

      return { schemaRows, rows };
    };
    const before = await snapshot();
    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name IN ('Moneyflow','TopList')`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    expect(await database.$queryRaw`PRAGMA integrity_check`).toEqual([{ integrity_check: 'ok' }]);
    await withDatabase(database, async () => {
      expect((await readDatasetCoverage()).map((entry) => entry.dataset)).toEqual(['stock-prices']);
      await expect(retireDatasets()).rejects.toThrow();
      const retained = await Promise.all([
        database.datasetSyncState.findMany({ where: { dataset: 'stock-prices' } }),
        database.datasetSyncPartition.findMany({ where: { dataset: 'stock-prices' } }),
        database.marketRecordEvidence.findMany({ where: { tableName: 'Daily' } }),
      ]);
      await withMaintenanceLock(retireDatasets);
      await withMaintenanceLock(retireDatasets);
      expect(
        await Promise.all([
          database.datasetSyncState.findMany(),
          database.datasetSyncPartition.findMany(),
          database.marketRecordEvidence.findMany(),
        ]),
      ).toEqual(retained);
    });
  } finally {
    await database.$disconnect();
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
