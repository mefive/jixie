import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pkg from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withDatabase } from '#infra/database/prisma.js';
import { readStrategy } from '../definitions/read.js';
import { strategyInputSignature, strategyResultSettings } from '../definitions/config.js';
import { readStrategyBacktestReport } from '../backtests/reports.js';
import { readStrategyScanReport } from '../scans/reports.js';
import { finishStrategyJob, pruneStrategyResults } from './retention.js';

const config = {
  name: 'Readable strategy',
  start: '20240101',
  end: '20241231',
  initialCash: 100_000,
  code: 'export default defineStrategy({onBar() {}});',
};
const settings = strategyResultSettings(config);
let directory: string;
let database: InstanceType<typeof pkg.PrismaClient>;

describe('latest strategy result retention', () => {
  beforeAll(async () => {
    directory = await mkdtemp('/tmp/jixie-strategy-retention-');
    await writeFile(`${directory}/test.db`, '');
    const databaseUrl = `file:${directory}/test.db`;
    database = new pkg.PrismaClient({ datasourceUrl: databaseUrl });
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    await database.factor.deleteMany();
    await database.factorReport.deleteMany();
    await database.user.deleteMany();
    await database.user.createMany({
      data: [
        { id: 'owner', email: 'retention@fixture.invalid' },
        { id: 'other', email: 'retention-other@fixture.invalid' },
      ],
    });
    await database.strategy.createMany({
      data: [
        { id: 'strategy', userId: 'owner', name: config.name, config },
        { id: 'another', userId: 'owner', name: 'Another', config },
        { id: 'foreign', userId: 'other', name: 'Foreign', config },
      ],
    });
  });
  afterAll(async () => {
    await database?.$disconnect();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the latest failed submission and active older jobs, then removes completed older rows and logs', async () => {
    await backtest('old', 1, 'done');
    await backtest('active', 2, 'running');
    await backtest('latest', 3, 'error');
    await database.$transaction((transaction) => pruneStrategyResults(transaction));

    expect((await database.backtestReport.findMany()).map((row) => row.id).sort()).toEqual([
      'active',
      'latest',
    ]);
    expect(await database.job.findUnique({ where: { id: 'job-old' } })).toBeNull();
    expect(
      (await database.job.findUniqueOrThrow({ where: { id: 'job-latest' } })).payload,
    ).toBeNull();
    expect(
      (await database.job.findUniqueOrThrow({ where: { id: 'job-active' } })).payload,
    ).not.toBeNull();
    await database.$transaction(async (transaction) => {
      const job = await transaction.job.update({
        where: { id: 'job-active' },
        data: { status: 'done' },
      });
      await finishStrategyJob(transaction, job);
    });

    expect(await database.backtestReport.count()).toBe(1);
    expect(await database.job.findUnique({ where: { id: 'job-active' } })).toBeNull();
    const strategy = await withDatabase(database, () => readStrategy('owner', 'strategy'));
    expect(strategy.lastResult).toBeNull();
    expect(strategy.lastBacktest).toMatchObject({ id: 'latest', status: 'error' });
    await expect(
      withDatabase(database, () => readStrategyBacktestReport('owner', 'old')),
    ).rejects.toMatchObject({ reason: 'backtest_report_not_found' });
  });

  it.each(['done', 'error', 'stale'])(
    'clears source input after a %s linked job even with corrupt kind metadata',
    async (status) => {
      await backtest('terminal', 1, 'running');
      await database.$transaction(async (transaction) => {
        const job = await transaction.job.update({
          where: { id: 'job-terminal' },
          data: { status, kind: 'corrupt-kind' },
        });
        await finishStrategyJob(transaction, job);
      });

      expect(
        (await database.job.findUniqueOrThrow({ where: { id: 'job-terminal' } })).payload,
      ).toBeNull();
      expect(await database.backtestReport.count()).toBe(1);
    },
  );

  it('retains backtests and scans independently and leaves other owners and strategies intact', async () => {
    await backtest('backtest', 1, 'done');
    await backtest('other-strategy', 2, 'done', 'another');
    await backtest('foreign-report', 2, 'done', 'foreign', 'other');
    await scan('scan-old', 1);
    await scan('scan-latest', 2);
    await database.$transaction((transaction) =>
      pruneStrategyResults(transaction, { userId: 'owner', strategyId: 'strategy' }),
    );

    expect(await database.backtestReport.count()).toBe(3);
    expect((await database.strategyScanReport.findMany()).map((row) => row.id)).toEqual([
      'scan-latest',
    ]);
    expect(await database.job.findUnique({ where: { id: 'job-scan-old' } })).toBeNull();
    await expect(
      withDatabase(database, () => readStrategyScanReport('owner', 'scan-old')),
    ).rejects.toMatchObject({ reason: 'strategy_scan_not_found' });
    await expect(
      withDatabase(database, () => readStrategyBacktestReport('other', 'backtest')),
    ).rejects.toMatchObject({ reason: 'backtest_report_not_found' });
  });

  it('strips surviving legacy source and terminal input, preserves metrics and dates, and only marks edited results for rerun', async () => {
    await backtest('legacy', 1, 'done');
    await database.backtestReport.update({
      where: { id: 'legacy' },
      data: { settings: config, inputSignature: null },
    });
    await scan('legacy-scan', 2);
    const timestamp = new Date('2024-12-31T00:00:00Z');
    await database.strategyScanReport.update({
      where: { id: 'legacy-scan' },
      data: { settings: config, inputSignature: null, updatedAt: timestamp },
    });
    await database.job.update({ where: { id: 'job-legacy' }, data: { kind: 'corrupt-kind' } });
    await database.$transaction((transaction) => pruneStrategyResults(transaction));

    const report = await database.backtestReport.findUniqueOrThrow({ where: { id: 'legacy' } });
    expect(report.settings).toEqual(settings);
    expect(report.inputSignature).toBe(strategyInputSignature(config));
    expect(
      (await database.job.findUniqueOrThrow({ where: { id: 'job-legacy' } })).payload,
    ).toBeNull();
    expect(
      (await database.strategyScanReport.findUniqueOrThrow({ where: { id: 'legacy-scan' } }))
        .updatedAt,
    ).toEqual(timestamp);
    let detail = await withDatabase(database, () => readStrategyBacktestReport('owner', 'legacy'));
    expect(detail.needsRerun).toBe(false);
    expect(detail.result).toMatchObject({ marker: 'legacy' });
    await database.strategy.update({
      where: { id: 'strategy' },
      data: { config: { ...config, code: 'new current source' } },
    });
    detail = await withDatabase(database, () => readStrategyBacktestReport('owner', 'legacy'));
    expect(detail.needsRerun).toBe(true);
    expect(detail.settings).not.toHaveProperty('code');
    expect(detail.result).toMatchObject({ marker: 'legacy' });
    expect(detail).not.toHaveProperty('codeHash');
    expect(detail).not.toHaveProperty('resultHash');
  });

  it('cleans more than one deletion batch without touching published Factor bindings', async () => {
    await database.factorReport.create({
      data: {
        id: 'factor-report',
        userId: 'owner',
        factor: 'factor',
        freq: 'month',
        start: config.start,
        end: config.end,
        legacyStatus: 'done',
        factorCodeSnapshot: 'published source',
      },
    });
    await database.factor.create({
      data: {
        id: 'factor',
        userId: 'owner',
        key: 'fixed',
        name: 'Fixed',
        code: 'published source',
        status: 'published',
        approvedReportId: 'factor-report',
        codeHash: 'published-hash',
      },
    });
    const before = await database.factor.findUniqueOrThrow({ where: { id: 'factor' } });
    await database.backtestReport.createMany({
      data: Array.from({ length: 260 }, (_, index) => ({
        id: `batch-${index}`,
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: config.name,
        settings,
        legacyStatus: 'done',
        createdAt: new Date(index),
      })),
    });
    await database.$transaction((transaction) => pruneStrategyResults(transaction));

    expect((await database.backtestReport.findMany()).map((row) => row.id)).toEqual(['batch-259']);
    expect(await database.factor.findUniqueOrThrow({ where: { id: 'factor' } })).toEqual(before);
    expect(
      await database.factorReport.findUnique({ where: { id: 'factor-report' } }),
    ).not.toBeNull();
    await database.factor.delete({ where: { id: 'factor' } });
    await database.factorReport.delete({ where: { id: 'factor-report' } });
  });
});

async function backtest(
  id: string,
  time: number,
  status: string,
  strategyId = 'strategy',
  userId = 'owner',
) {
  await database.backtestReport.create({
    data: {
      id,
      userId,
      strategyId,
      strategyName: config.name,
      settings,
      inputSignature: strategyInputSignature(config),
      payload: status === 'done' ? { marker: id } : undefined,
      createdAt: new Date(time),
      job: {
        create: {
          id: `job-${id}`,
          userId,
          kind: 'backtest',
          key: strategyId,
          status,
          payload: { config },
          logs: '[{"text":"old logs"}]',
        },
      },
    },
  });
}
async function scan(id: string, time: number) {
  await database.strategyScanReport.create({
    data: {
      id,
      userId: 'owner',
      strategyId: 'strategy',
      strategyName: config.name,
      settings,
      spec: { dimensions: [] },
      createdAt: new Date(time),
      inputSignature: strategyInputSignature(config),
      payload: { cells: [] },
      job: {
        create: {
          id: `job-${id}`,
          userId: 'owner',
          kind: 'strategy-scan',
          key: 'strategy',
          status: 'done',
          payload: { config },
        },
      },
    },
  });
}
