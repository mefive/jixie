import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import exports from '@prisma/client';
import { expect, it } from 'vitest';

const { PrismaClient } = exports;
const migrationName = '20260909120000_report_bound_deployments';

it('upgrades legacy deployment snapshots without losing signal/account children or guessing reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jixie-report-deployment-migration-'));
  const schemaPath = join(directory, 'schema.prisma');
  const databaseUrl = `file:${join(directory, 'migration.db')}`;
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const migrations = resolve('prisma/migrations');
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        schemaPath,
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
    );

  try {
    await writeFile(join(directory, 'migration.db'), '');
    await cp(resolve('prisma/schema.prisma'), schemaPath);
    await mkdir(join(directory, 'migrations'));
    for (const name of await readdir(migrations)) {
      if (name !== migrationName) {
        await cp(join(migrations, name), join(directory, 'migrations', name), { recursive: true });
      }
    }
    migrate();
    await prisma.user.create({ data: { id: 'owner', email: 'migration@fixture.invalid' } });
    const config = { name: 'Legacy', code: 'legacy frozen code', initialCash: 100_000 };
    await prisma.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Changed draft',
        config: { code: 'different draft' },
      },
    });
    // The old deployment table has no report columns; use a parameterized fixture insert.
    for (const status of ['active', 'paused']) {
      await prisma.$executeRaw`INSERT INTO "StrategyDeployment" ("id", "userId", "strategyId", "strategyName", "status", "config", "factorDependencies", "codeHash", "locale", "deployedAt", "stoppedAt", "createdAt", "updatedAt") VALUES (${status}, 'owner', 'strategy', 'Legacy', ${status}, ${JSON.stringify(config)}, '[]', 'old-hash', 'en', ${new Date('2026-01-01')}, ${status === 'paused' ? new Date('2026-01-02') : null}, ${new Date('2026-01-01')}, ${new Date('2026-01-02')})`;
    }
    await prisma.signalRun.create({
      data: {
        id: 'run',
        userId: 'owner',
        deploymentId: 'active',
        strategyId: 'strategy',
        tradeDate: '20260105',
        execDate: '20260106',
        status: 'done',
        signals: [],
      },
    });
    await prisma.strategyAccountSnapshot.create({
      data: {
        id: 'account',
        userId: 'owner',
        deploymentId: 'active',
        kind: 'actual',
        tradeDate: '20260105',
        cash: 100_000,
        marketValue: 0,
        equity: 100_000,
        positions: [],
        isBaseline: true,
        sourceRunId: 'run',
      },
    });
    const beforeAccounts = await prisma.strategyAccountSnapshot.findMany();
    const beforeRuns = await prisma.signalRun.findMany();
    await prisma.$disconnect();

    await cp(join(migrations, migrationName), join(directory, 'migrations', migrationName), {
      recursive: true,
    });
    migrate();
    expect(await prisma.strategyDeployment.findMany({ orderBy: { id: 'asc' } })).toEqual([
      expect.objectContaining({
        id: 'active',
        status: 'active',
        backtestReportId: null,
        activeReportId: null,
        config,
        stoppedAt: null,
        codeHash: 'old-hash',
      }),
      expect.objectContaining({
        id: 'paused',
        status: 'paused',
        backtestReportId: null,
        activeReportId: null,
        config,
        stoppedAt: new Date('2026-01-02'),
        codeHash: 'old-hash',
      }),
    ]);
    expect(await prisma.signalRun.findMany()).toEqual(beforeRuns);
    expect(await prisma.strategyAccountSnapshot.findMany()).toEqual(beforeAccounts);
    expect(await prisma.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    // A schema-only diff after applying the full history must be empty.
    const drift = execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'diff',
        '--from-url',
        databaseUrl,
        '--to-schema-datamodel',
        schemaPath,
        '--exit-code',
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(drift).toContain('No difference detected');
    await prisma.user.delete({ where: { id: 'owner' } });
    expect(await prisma.strategyDeployment.count()).toBe(0);
    expect(await prisma.signalRun.count()).toBe(0);
    expect(await prisma.strategyAccountSnapshot.count()).toBe(0);
  } finally {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
