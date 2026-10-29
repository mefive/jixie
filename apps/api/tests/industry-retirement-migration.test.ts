import { legacyMarketTable } from './legacy-market-tables.js';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const retirement = '20261027110000_remove_industry_data';

it('drops only industry tables and the stock industry column while preserving user data and retained sources', async () => {
  const directory = await mkdtemp('/tmp/jixie-industry-retirement-');
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

    await database.$executeRaw`INSERT INTO SwIndustryMember (tsCode,l1Code,l1Name,inDate) VALUES ('600000.SH','801780.SI','银行','20000101')`;
    await database.$executeRaw`INSERT INTO SwIndexDaily (tsCode,tradeDate,name,close) VALUES ('801780.SI','20260915','银行',100)`;
    await database.$executeRaw`INSERT INTO StockBasic (tsCode,symbol,name,area,industry,market,listDate,listStatus) VALUES ('600000.SH','600000','浦发银行','上海','银行','主板','19991110','L')`;
    await database.user.create({
      data: { id: 'owner', email: 'industry-upgrade@fixture.invalid' },
    });
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
        neutral: 'size_industry',
        specJson: '{"version":1,"neutral":"size_industry"}',
        factorCodeSnapshot: 'export default defineFactor({compute: bar => bar.pb});',
      },
    });
    await database.factor.createMany({
      data: [
        {
          id: 'legacy',
          userId: 'owner',
          key: 'legacy_v1',
          name: 'Saved industry source',
          status: 'published',
          approvedReportId: 'approved',
          code: 'export default defineFactor({compute: bar => bar.pb});',
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
        config: { code: 'ctx.industry("600000.SH")' },
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
        source: 'data.cross_section("equity")["industry"]',
      },
    });
    const datasets = ['industry-members', 'industry-prices', 'stock-prices'];
    await legacyMarketTable(database, 'DatasetSyncState').createMany({
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
    await legacyMarketTable(database, 'MarketRecordEvidence').createMany({
      data: ['SwIndustryMember', 'SwIndexDaily', 'Daily'].map((tableName, index) => ({
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
      >`SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'SwIndustryMember%' AND name NOT LIKE 'SwIndexDaily%' AND name NOT LIKE '_prisma_migrations%' ORDER BY name`;
      const rows = await Promise.all(
        schemaRows
          .filter((row) => row.type === 'table')
          .map(async (row) => ({
            table: row.name,
            columns: (
              await database.$queryRawUnsafe<Array<{ cid: number; name: string }>>(
                `PRAGMA table_info("${row.name.replaceAll('"', '""')}")`,
              )
            )
              .filter((column) => row.name !== 'StockBasic' || column.name !== 'industry')
              .map(({ cid: _cid, ...column }) => column),
            records: await database.$queryRawUnsafe(
              row.name === 'StockBasic'
                ? 'SELECT tsCode,symbol,name,area,market,listDate,delistDate,listStatus FROM StockBasic ORDER BY tsCode'
                : `SELECT * FROM "${row.name.replaceAll('"', '""')}" ORDER BY rowid`,
            ),
          })),
      );

      return {
        schemaRows: schemaRows.map((row) =>
          row.name === 'StockBasic'
            ? { ...row, sql: 'StockBasic shape compared by column metadata' }
            : row,
        ),
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
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name IN ('SwIndustryMember','SwIndexDaily')`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    expect(await database.$queryRaw`PRAGMA integrity_check`).toEqual([{ integrity_check: 'ok' }]);
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
