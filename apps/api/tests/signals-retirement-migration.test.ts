import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

const retirement = '20261025120000_remove_signals';
const retiredTables = [
  'StrategyDeployment',
  'SignalRun',
  'SignalExecution',
  'StrategyAccountSnapshot',
  'SignalResolution',
  'SignalFill',
  'SignalAccountMarketInput',
  'SignalAccountState',
];

it('removes populated Signals tables while preserving users, research, backtests and Jobs', async () => {
  const directory = await mkdtemp('/tmp/jixie-signals-retirement-');
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const databaseUrl = `file:${directory}/upgrade.db`;
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
    await cp(resolve('prisma/schema.prisma'), schema);
    await mkdir(migrations);
    const names = await readdir(resolve('prisma/migrations'));
    expect(names).toContain(retirement);
    for (const name of names) {
      if (name < retirement || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();

    await database.user.create({ data: { id: 'owner', email: 'retirement@fixture.invalid' } });
    await database.strategy.create({
      data: { id: 'strategy', userId: 'owner', name: 'Kept', config: {} },
    });
    await database.backtestReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Kept',
        settings: {},
        payload: { kept: true },
      },
      select: { id: true },
    });
    await database.agentConversation.create({
      data: {
        id: 'conversation',
        userId: 'owner',
        surface: 'research',
        title: 'Kept research',
      },
    });
    await database.researchDocument.create({
      data: { id: 'research', userId: 'owner', conversationId: 'conversation' },
    });
    await database.job.create({
      data: {
        id: 'backtest-job',
        userId: 'owner',
        kind: 'backtest',
        key: 'report',
        status: 'done',
        backtestReportId: 'report',
        logs: JSON.stringify([{ text: 'kept' }]),
      },
    });

    // 旧模型已退出生成的 Client，使用固定 SQL 构造真实外键链。
    // The generated client no longer exposes retired models; fixed SQL seeds their real FK chain.
    await database.$executeRaw`INSERT INTO StrategyDeployment (id, userId, strategyId, backtestReportId, strategyName, status, config, codeHash, locale, updatedAt) VALUES ('deployment', 'owner', 'strategy', 'report', 'Kept', 'active', '{}', 'hash', 'en', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO SignalRun (id, userId, deploymentId, strategyId, tradeDate, execDate, updatedAt) VALUES ('run', 'owner', 'deployment', 'strategy', '20261023', '20261026', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO SignalExecution (id, userId, signalRunId, deploymentId, code, name, assetType, action, refPrice, refAmount, source, updatedAt) VALUES ('execution', 'owner', 'run', 'deployment', '510300.SH', 'ETF', 'etf', 'buy', 1, 100, 'target', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO StrategyAccountSnapshot (id, userId, deploymentId, kind, tradeDate, cash, marketValue, equity, positions, updatedAt) VALUES ('snapshot', 'owner', 'deployment', 'actual', '20261023', 100, 0, 100, '[]', CURRENT_TIMESTAMP)`;
    await database.$executeRaw`INSERT INTO SignalResolution (id, deploymentId, executionId, kind, requestKey, accountRevision, payload) VALUES ('resolution', 'deployment', 'execution', 'actual', 'resolution-key', 1, '{}')`;
    await database.$executeRaw`INSERT INTO SignalFill (id, deploymentId, executionId, requestKey, tradeDate, payload) VALUES ('fill', 'deployment', 'execution', 'fill-key', '20261023', '{}')`;
    await database.$executeRaw`INSERT INTO SignalAccountMarketInput (id, deploymentId, tradeDate, payload, inputHash) VALUES ('input', 'deployment', '20261023', '{}', 'hash')`;
    await database.$executeRaw`INSERT INTO SignalAccountState (id, deploymentId, kind, generation, tradeDate, accountRevision, payload) VALUES ('state', 'deployment', 'actual', 'generation', '20261023', 1, '{}')`;
    await database.$executeRaw`INSERT INTO Job (id, userId, kind, key, status, signalRunId, updatedAt) VALUES ('retired-job', 'owner', 'signal', 'run', 'queued', 'run', CURRENT_TIMESTAMP)`;
    for (const table of retiredTables) {
      expect(await database.$queryRawUnsafe(`SELECT id FROM "${table}"`)).toHaveLength(1);
    }
    const snapshot = async () =>
      Promise.all([
        database.user.findMany(),
        database.strategy.findMany(),
        database.$queryRaw`SELECT * FROM BacktestReport ORDER BY id`,
        database.researchDocument.findMany(),
        database.job.findMany({ orderBy: { id: 'asc' } }),
      ]);
    const before = await snapshot();

    await cp(resolve('prisma/migrations', retirement), join(migrations, retirement), {
      recursive: true,
    });
    deploy();

    expect(await snapshot()).toEqual(before);
    const tables = await database.$queryRaw<
      Array<{ name: string }>
    >`SELECT name FROM sqlite_master WHERE type = 'table'`;
    expect(
      tables.map((table) => table.name).filter((name) => retiredTables.includes(name)),
    ).toEqual([]);
    const columns = await database.$queryRaw<Array<{ name: string }>>`PRAGMA table_info('Job')`;
    expect(columns.some((column) => column.name === 'signalRunId')).toBe(false);
    expect(await database.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    await database.strategy.delete({ where: { id: 'strategy' } });
    expect(await database.backtestReport.count()).toBe(0);
    expect(await database.job.findUnique({ where: { id: 'backtest-job' } })).toBeNull();
    expect(await database.researchDocument.count()).toBe(1);
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
