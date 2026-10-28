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

const retirement = '20261027150000_remove_macro_rates_fx_cross_market';

it('drops seven macro, rates, FX and benchmark tables while preserving retained schema, sources, user code, publication and bound reports', async () => {
  const directory = await mkdtemp('/tmp/jixie-macro-retirement-');
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

    const retiredTables = [
      'YieldCurvePoint',
      'FxDaily',
      'MacroSeries',
      'MacroObservation',
      'MacroReleaseSchedule',
      'MarketBenchmark',
      'MarketBenchmarkDaily',
    ];
    for (const table of retiredTables) {
      const columns = await database.$queryRawUnsafe<
        Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>
      >(`PRAGMA table_info("${table}")`);
      const required = columns.filter(
        (column) => column.dflt_value === null && Number(column.notnull) === 1,
      );
      const values = required.map((column) => (/INT|REAL/.test(column.type) ? 1 : 'fixture'));
      await database.$executeRawUnsafe(
        `INSERT INTO "${table}" (${required.map((column) => `"${column.name}"`).join(',')}) VALUES (${values.map(() => '?').join(',')})`,
        ...values,
      );
    }
    await database.stockBasic.create({
      data: {
        tsCode: '600000.SH',
        symbol: '600000',
        name: '浦发银行',
        listDate: '19991110',
        listStatus: 'L',
      },
    });
    await database.user.create({
      data: { id: 'owner', email: 'macro-upgrade@fixture.invalid' },
    });
    await database.daily.create({
      data: { tsCode: '600000.SH', tradeDate: '20260915', close: 10 },
    });
    const legacyCode =
      "export default defineFactorV2({ version: 2, analysisKind: 'time_series', inputs: ['rates.cgb.yield.10y'], compute(ctx) { return ctx.value('rates.cgb.yield.10y'); } });";
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
        neutral: 'size',
        specJson: '{"version":1,"neutral":"size"}',
        factorCodeSnapshot: legacyCode,
      },
    });
    await database.factor.createMany({
      data: [
        {
          id: 'legacy',
          userId: 'owner',
          key: 'legacy_v1',
          name: 'Saved yield source',
          status: 'published',
          approvedReportId: 'approved',
          code: legacyCode,
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
        config: { code: 'ctx.futures.orderContracts("IF.CFX", 1)' },
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
        source: 'data.macro("cn_cpi_yoy")',
      },
    });
    const datasets = [
      'treasury-curves',
      'credit-curves',
      'external-curves',
      'external-fx',
      'cross-market-benchmarks',
      'china-macro',
      'us-cpi',
      'stock-prices',
    ];
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
      data: [...retiredTables, 'Daily'].map((tableName, index) => ({
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

    await database.tradeCal.createMany({
      data: ['SSE', 'SZSE', 'US_TREASURY', 'FXCM', 'HKEX', 'NYSE', 'NASDAQ'].map((exchange) => ({
        exchange,
        calDate: '20260915',
        isOpen: 1,
      })),
    });
    await database.marketCalculationState.createMany({
      data: ['future-publication', 'commodity-continuous', 'market-state', 'unrelated-history'].map(
        (kind) => ({
          kind,
          scope: 'all',
          date: '20260915',
          status: 'error',
          calculationVersion: 'v1',
          auditVersion: 'v1',
        }),
      ),
    });
    for (const scope of ['SSE', 'SZSE', 'US_TREASURY', 'FXCM', 'HKEX', 'NYSE', 'NASDAQ']) {
      await database.datasetSyncState.create({
        data: {
          dataset: 'calendar',
          scope,
          historyStart: '20200101',
          backfillCursor: '20200101',
          policyVersion: 'sync-v1',
        },
      });
      await database.datasetSyncPartition.create({
        data: {
          id: `calendar:${scope}`,
          dataset: 'calendar',
          scope,
          startDate: '20260915',
          endDate: '20260915',
          status: 'error',
          policyVersion: 'sync-v1',
        },
      });
    }

    const snapshot = async () => {
      const schemaRows = await database.$queryRaw<
        Array<{ name: string; type: string; sql: string }>
      >`SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations%' ORDER BY name`;
      const retainedSchemaRows = schemaRows.filter(
        (row) =>
          !retiredTables.some((table) => row.name === table || row.name.startsWith(`${table}_`)),
      );
      const rows = await Promise.all(
        retainedSchemaRows
          .filter((row) => row.type === 'table')
          .map(async (row) => ({
            table: row.name,
            columns: (
              await database.$queryRawUnsafe<Array<{ cid: number; name: string }>>(
                `PRAGMA table_info("${row.name.replaceAll('"', '""')}")`,
              )
            ).map(({ cid: _cid, ...column }) => column),
            records: await database.$queryRawUnsafe(
              `SELECT * FROM "${row.name.replaceAll('"', '""')}" ORDER BY rowid`,
            ),
          })),
      );

      return {
        schemaRows: retainedSchemaRows,
        rows,
      };
    };
    const before = await snapshot();
    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    expect(
      await database.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE name IN (${retiredTables.map(() => '?').join(',')})`,
        ...retiredTables,
      ),
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    expect(await database.$queryRaw`PRAGMA integrity_check`).toEqual([{ integrity_check: 'ok' }]);
    await withDatabase(database, async () => {
      expect((await readDatasetCoverage()).map((entry) => entry.dataset)).not.toContain(
        'external-curves',
      );
      expect(
        (await readDatasetCoverage()).find((entry) => entry.dataset === 'calendar')?.errors,
      ).toBe(2);
      await expect(retireDatasets()).rejects.toThrow();
      const retained = await Promise.all([
        database.datasetSyncState.findMany({
          where: {
            dataset: { in: ['stock-prices', 'calendar'] },
            scope: { in: ['all', 'SSE', 'SZSE'] },
          },
          orderBy: [{ dataset: 'asc' }, { scope: 'asc' }],
        }),
        database.datasetSyncPartition.findMany({
          where: {
            dataset: { in: ['stock-prices', 'calendar'] },
            scope: { in: ['all', 'SSE', 'SZSE'] },
          },
          orderBy: [{ dataset: 'asc' }, { scope: 'asc' }],
        }),
        database.marketRecordEvidence.findMany({ where: { tableName: 'Daily' } }),
      ]);
      await withMaintenanceLock(retireDatasets);
      await withMaintenanceLock(retireDatasets);
      expect(
        await Promise.all([
          database.datasetSyncState.findMany({ orderBy: [{ dataset: 'asc' }, { scope: 'asc' }] }),
          database.datasetSyncPartition.findMany({
            orderBy: [{ dataset: 'asc' }, { scope: 'asc' }],
          }),
          database.marketRecordEvidence.findMany(),
        ]),
      ).toEqual(retained);
      expect(
        (await database.tradeCal.findMany({ orderBy: { exchange: 'asc' } })).map(
          (row) => row.exchange,
        ),
      ).toEqual(['SSE', 'SZSE']);
      expect((await database.marketCalculationState.findMany()).map((row) => row.kind)).toEqual([
        'unrelated-history',
      ]);
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
