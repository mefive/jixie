import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pkg from '@prisma/client';
import { expect, it } from 'vitest';
import { pruneStrategyResults } from '#strategy/results/retention.js';
import { strategyInputSignature, strategyResultSettings } from '#strategy/definitions/config.js';

const migration = '20261026140000_simplify_strategy_results';
it('upgrades legacy snapshots, keeps the newest failed result and removes sources before serving', async () => {
  const directory = await mkdtemp('/tmp/jixie-strategy-results-upgrade-');
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const database = new pkg.PrismaClient({ datasourceUrl: databaseUrl });
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
  const config = {
    name: 'Legacy strategy',
    start: '20240101',
    end: '20241231',
    initialCash: 100_000,
    code: 'legacy executable source',
  };
  const encoded = JSON.stringify(config);
  try {
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of await readdir(resolve('prisma/migrations'))) {
      if (name < migration || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();
    await database.user.create({
      data: { id: 'owner', email: 'strategy-upgrade@fixture.invalid' },
    });
    await database.$executeRaw`INSERT INTO Strategy (id,userId,name,config,lastResult,updatedAt) VALUES ('strategy','owner','Legacy strategy',${encoded},'{}',CURRENT_TIMESTAMP)`;
    for (const [id, status, time] of [
      ['old', 'done', 1],
      ['latest', 'error', 2],
    ] as const) {
      await database.$executeRaw`INSERT INTO BacktestReport (id,userId,strategyId,strategyName,status,config,payload,codeHash,resultHash,createdAt) VALUES (${id},'owner','strategy','Legacy strategy',${status},${encoded},'{}','old-code-hash','old-result-hash',${new Date(time)})`;
      await database.job.create({
        data: {
          id: `job-${id}`,
          userId: 'owner',
          key: 'strategy',
          kind: 'backtest',
          status,
          backtestReportId: id,
          payload: { config },
          logs: '[{"text":"legacy"}]',
        },
      });
    }
    await database.$executeRaw`INSERT INTO StrategyScanReport (id,userId,strategyId,strategyName,status,config,spec,codeHash,payload,updatedAt) VALUES ('scan','owner','strategy','Legacy strategy','done',${encoded},'{}','old-hash','{}',CURRENT_TIMESTAMP)`;
    await cp(resolve('prisma/migrations', migration), join(migrations, migration), {
      recursive: true,
    });
    deploy();
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    expect(
      (await database.backtestReport.findUniqueOrThrow({ where: { id: 'latest' } })).settings,
    ).toEqual(config);
    await database.$transaction((transaction) => pruneStrategyResults(transaction));

    expect(await database.backtestReport.findUnique({ where: { id: 'old' } })).toBeNull();
    expect(await database.job.findUnique({ where: { id: 'job-old' } })).toBeNull();
    expect(
      (await database.job.findUniqueOrThrow({ where: { id: 'job-latest' } })).payload,
    ).toBeNull();
    expect(
      await database.backtestReport.findUniqueOrThrow({ where: { id: 'latest' } }),
    ).toMatchObject({
      legacyStatus: 'error',
      settings: strategyResultSettings(config),
      inputSignature: strategyInputSignature(config),
      payload: {},
    });
    expect(
      (await database.strategyScanReport.findUniqueOrThrow({ where: { id: 'scan' } })).settings,
    ).toEqual(strategyResultSettings(config));
    expect(
      (await database.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).config,
    ).toEqual(config);
    const strategyColumns = await database.$queryRaw<
      Array<{ name: string }>
    >`PRAGMA table_info('Strategy')`;
    expect(strategyColumns.map((column) => column.name)).not.toContain('lastResult');
    const reportColumns = await database.$queryRaw<
      Array<{ name: string }>
    >`PRAGMA table_info('BacktestReport')`;
    expect(reportColumns.map((column) => column.name)).not.toContain('codeHash');
    expect(reportColumns.map((column) => column.name)).not.toContain('resultHash');
    await database.$transaction((transaction) => pruneStrategyResults(transaction));
    expect(await database.backtestReport.count()).toBe(1);
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
