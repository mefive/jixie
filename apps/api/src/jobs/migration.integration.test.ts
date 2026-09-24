import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import prismaPackage from '@prisma/client';
import { expect, it } from 'vitest';

it('upgrades existing terminal records without fabricating Jobs or changing physical status columns', async () => {
  const directory = await mkdtemp('/tmp/jixie-job-upgrade-');
  const schema = join(directory, 'schema.prisma');
  const migrations = join(directory, 'migrations');
  const databaseUrl = `file:${directory}/upgrade.db`;
  const database = new prismaPackage.PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const names = await readdir(resolve('prisma/migrations'));
    const migration = names.find((name) => name.endsWith('_simplify_background_jobs'));
    if (!migration) {
      throw new Error('Generate and review simplify_background_jobs migration before verification');
    }
    await writeFile(join(directory, 'upgrade.db'), '');
    await mkdir(migrations);
    await cp(resolve('prisma/schema.prisma'), schema);
    for (const name of names) {
      if (name < migration || name === 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
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
    deploy();
    await database.user.create({ data: { id: 'owner', email: 'jobs-upgrade@fixture.invalid' } });
    await database.strategy.create({
      data: { id: 'strategy', userId: 'owner', name: 'Legacy', config: {} },
    });
    await database.strategyDeployment.create({
      data: {
        id: 'deployment',
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Legacy',
        status: 'paused',
        config: {},
        codeHash: 'hash',
        locale: 'en',
      },
    });
    for (const status of ['done', 'error', 'stale']) {
      await database.backtestReport.create({
        data: {
          id: `legacy:${status}`,
          userId: 'owner',
          strategyId: 'strategy',
          strategyName: 'Legacy',
          config: {},
          legacyStatus: status,
          legacyError: `detail:${status}`,
        },
      });
      await database.factorReport.create({
        data: {
          id: `factor:${status}`,
          userId: 'owner',
          factor: 'value',
          freq: 'month',
          start: '20200101',
          end: '20240101',
          legacyStatus: status,
          failureMessage: `detail:${status}`,
        },
      });
      await database.strategyScanReport.create({
        data: {
          id: `scan:${status}`,
          userId: 'owner',
          strategyId: 'strategy',
          strategyName: 'Legacy',
          config: {},
          spec: {},
          codeHash: 'hash',
          legacyStatus: status,
          legacyError: `detail:${status}`,
        },
      });
      await database.signalRun.create({
        data: {
          id: `signal:${status}`,
          userId: 'owner',
          strategyId: 'strategy',
          deploymentId: 'deployment',
          tradeDate: status,
          execDate: status,
          legacyStatus: status,
          legacyError: `detail:${status}`,
        },
      });
      await database.researchCuratorRun.create({
        data: {
          id: `curator:${status}`,
          userId: 'owner',
          cursorTo: new Date(0),
          legacyStatus: status,
          legacyError: `detail:${status}`,
        },
      });
    }
    const before = await Promise.all([
      database.backtestReport.findMany(),
      database.factorReport.findMany(),
      database.strategyScanReport.findMany(),
      database.signalRun.findMany(),
      database.researchCuratorRun.findMany(),
    ]);
    for (const name of names) {
      if (name >= migration && name !== 'migration_lock.toml') {
        await cp(resolve('prisma/migrations', name), join(migrations, name), { recursive: true });
      }
    }
    deploy();
    const after = await Promise.all([
      database.backtestReport.findMany(),
      database.factorReport.findMany(),
      database.strategyScanReport.findMany(),
      database.signalRun.findMany(),
      database.researchCuratorRun.findMany(),
    ]);
    expect(after).toEqual(before);
    expect(await database.job.count()).toBe(0);
    const tables = [
      'BacktestReport',
      'FactorReport',
      'StrategyScanReport',
      'SignalRun',
      'ResearchCuratorRun',
    ];
    for (const table of tables) {
      // Fixed fixture identifiers, never user-controlled SQL.
      const columns = await database.$queryRawUnsafe<
        Array<{ name: string; notnull: bigint; dflt_value: string | null }>
      >(`PRAGMA table_info("${table}")`);
      expect(columns.find((column) => column.name === 'status')).toMatchObject({
        notnull: 0n,
        dflt_value: null,
      });
      expect(columns.some((column) => column.name === 'legacyStatus')).toBe(false);
    }
  } finally {
    await database.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
