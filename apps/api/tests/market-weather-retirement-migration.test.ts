import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';
import { withDatabase } from '#infra/database/prisma.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import {
  MARKET_AUDIT_VERSION,
  MARKET_CALCULATION_VERSION,
  readMarketCalculationBacklog,
  refreshMarketCalculations,
} from '#maintenance/calculations.js';

const retirement = '20261026190000_remove_market_weather';

it('drops weather history and retires its backlog while preserving raw data and independent research', async () => {
  const directory = await mkdtemp('/tmp/jixie-market-weather-retirement-');
  const databaseUrl = `file:${directory}/upgrade.db`;
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

    await database.user.create({ data: { id: 'owner', email: 'weather-upgrade@fixture.invalid' } });
    await database.daily.create({
      data: { tsCode: '600000.SH', tradeDate: '20260915', close: 10 },
    });
    await database.indexDailyBasic.create({
      data: { tsCode: '000300.SH', tradeDate: '20260915', peTtm: 12 },
    });
    await database.factorReport.create({
      data: {
        id: 'approved',
        userId: 'owner',
        factor: 'published',
        legacyStatus: 'done',
        freq: 'month',
        start: '20240101',
        end: '20241231',
        payload: '{}',
        factorCodeSnapshot: 'independent factor source',
      },
    });
    await database.factor.create({
      data: {
        id: 'published',
        userId: 'owner',
        key: 'published_v1',
        name: 'Published',
        status: 'published',
        code: 'independent factor source',
        approvedReportId: 'approved',
      },
    });
    await database.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Consumer',
        config: { code: 'independent strategy source' },
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
    await database.marketDataState.create({ data: { key: 'global' } });
    await database.marketCalculationState.createMany({
      data: ['market-state', 'commodity-continuous'].map((kind) => ({
        kind,
        scope: 'all',
        date: '20260915',
        status: kind === 'market-state' ? 'error' : 'ready',
        calculationVersion: MARKET_CALCULATION_VERSION,
        auditVersion: MARKET_AUDIT_VERSION,
      })),
    });

    // 新 Client 不含退役模型，仅在隔离旧库构造历史派生行。
    // Seed historical derived rows only in the isolated old schema; the new client omits these models.
    await database.$executeRaw`INSERT INTO MarketIndicator (tradeDate,tradedCount,return20) VALUES ('20260915',1,0.1)`;
    await database.$executeRaw`INSERT INTO IndexIndicator (indexCode,tradeDate,membershipDate,tradedCount,peTtm) VALUES ('000300.SH','20260915','20260901',1,12)`;
    await database.$executeRaw`INSERT INTO IndustryIndicator (l1Code,l1Name,tradeDate,tradedCount) VALUES ('801010.SI','Fixture','20260915',1)`;

    const snapshot = () =>
      Promise.all([
        database.daily.findMany(),
        database.indexDailyBasic.findMany(),
        database.factor.findMany(),
        database.factorReport.findMany(),
        database.strategy.findMany(),
        database.agentConversation.findMany(),
        database.researchDocument.findMany(),
        database.marketCalculationState.findMany(),
        database.$queryRaw`SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'MarketIndicator%' AND name NOT LIKE 'IndexIndicator%' AND name NOT LIKE 'IndustryIndicator%' ORDER BY name`,
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    expect(
      await database.$queryRaw`SELECT name FROM sqlite_master WHERE name IN ('MarketIndicator','IndexIndicator','IndustryIndicator')`,
    ).toEqual([]);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    await withDatabase(database, async () => {
      expect(await readMarketCalculationBacklog()).toEqual({ waiting: 0, errors: 0, stale: 0 });
      const retained = await database.marketCalculationState.findFirstOrThrow({
        where: { kind: 'commodity-continuous' },
      });
      await withMaintenanceLock(() =>
        refreshMarketCalculations({ targetDate: '20260915', limit: 0 }),
      );
      expect(
        await database.marketCalculationState.findMany({ where: { kind: 'market-state' } }),
      ).toEqual([]);
      expect(await database.marketCalculationState.findFirstOrThrow()).toEqual(retained);
    });
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
