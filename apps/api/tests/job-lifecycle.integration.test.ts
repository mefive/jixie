import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BacktestSummary } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import prismaPackage from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-job-contract-');
  const databasePath = `${fixture.directory}/jobs.db`;
  writeFileSync(databasePath, '');
  const mocked = {
    prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }),
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
const execution = vi.hoisted(() => ({
  worker: vi.fn(),
  rename: vi.fn(),
}));
vi.mock('../src/server.js', () => ({ buildApp: vi.fn() }));
vi.mock('#jobs/worker.js', () => ({ runWorker: execution.worker }));
vi.mock('#strategy/definitions/naming.js', () => ({
  refreshStrategyName: execution.rename,
}));

import { prisma } from '#infra/database/prisma.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { strategyBacktestLifecycle } from '#strategy/backtests/job-lifecycle.js';
import { JobLogs } from '#jobs/job-logs.js';
import { JobService } from '#jobs/job-service.js';

const kinds = ['backtest', 'factor-analysis', 'strategy-scan'] as const;
type Kind = (typeof kinds)[number];
const summary: BacktestSummary = {
  name: 'Fixture',
  start: '20240101',
  end: '20240102',
  days: 2,
  initialCash: 100,
  finalValue: 101,
  totalReturn: 0.01,
  annReturn: 0.01,
  sharpe: 1,
  maxDrawdown: 0,
  trades: 0,
  tradeLog: [],
  nav: [],
};
let sequence = 0;
let ids: Record<Kind, string>;

const links = {
  backtest: 'backtestReportId',
  'factor-analysis': 'factorReportId',
  'strategy-scan': 'strategyScanReportId',
};

async function entityStatus(kind: Kind): Promise<string> {
  const job = await prisma.job.findFirstOrThrow({
    where: { [links[kind]]: ids[kind] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return job.status === 'queued' ? 'running' : job.status;
}

const { Prisma: prismaValues } = prismaPackage;
const config = {
  name: 'Fixture',
  start: '20240101',
  end: '20240102',
  initialCash: 100,
  code: 'fixture',
};
function payload(kind: Kind): Prisma.InputJsonValue {
  switch (kind) {
    case 'backtest':
      return {
        task: 'backtest',
        reportId: ids.backtest,
        strategyId: 'strategy',
        userId: 'owner',
        locale: 'en',
        config,
      };
    case 'factor-analysis':
      return {
        reportId: ids['factor-analysis'],
        factor: 'fixture',
        locale: 'en',
        failedMessage: 'report failure',
        source: { kind: 'time_series', label: 'Fixture', code: 'fixture' },
        spec: {
          version: 1,
          analysisKind: 'time_series',
          start: '20200101',
          end: '20241231',
          observationFrequency: 'daily',
          assets: ['511010.SH'],
          target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
          dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20250131' },
          inference: { standardError: 'newey_west', lag: 'automatic' },
        },
      };
    case 'strategy-scan':
      return {
        task: 'strategy-scan',
        reportId: ids['strategy-scan'],
        userId: 'owner',
        locale: 'en',
        config,
        spec: { dimensions: [] },
        parameters: {},
        ranges: { full: { start: '20240101', end: '20240102' } },
      };
  }
}

async function complete(kind: Kind, status: 'done' | 'error') {
  if (status === 'done' && kind === 'backtest') {
    execution.worker.mockResolvedValueOnce(summary);
  }
  if (status === 'done' && kind === 'factor-analysis') {
    execution.worker.mockResolvedValueOnce('{"score":1}');
  }
  if (status === 'error') {
    execution.worker.mockRejectedValueOnce(new Error('job failure'));
  }
  return executeFixtureJob(ids[kind]);
}

describe('durable job and business lifecycle transactions', () => {
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', `file:${join(fixture.directory, 'jobs.db')}`);
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${join(fixture.directory, 'jobs.db')}` },
        stdio: 'pipe',
      },
    );
  }, 30_000);

  beforeEach(async () => {
    execution.worker.mockReset().mockResolvedValue({
      ...summary,
      cells: [],
      dataCutoff: '20240101',
    });
    execution.rename.mockReset().mockResolvedValue(false);
    sequence += 1;
    ids = Object.fromEntries(kinds.map((kind) => [kind, `${kind}-${sequence}`])) as Record<
      Kind,
      string
    >;
    await prisma.job.deleteMany();
    await prisma.factorCorrelation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.user.create({ data: { id: 'owner', email: 'owner@example.com' } });
    await prisma.strategy.create({
      data: { id: 'strategy', userId: 'owner', name: 'Fixture', config: {} },
    });
    await prisma.backtestReport.create({
      data: {
        id: ids.backtest,
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Fixture',
        legacyStatus: 'running',
        config: {},
      },
    });
    await prisma.factorReport.create({
      data: {
        id: ids['factor-analysis'],
        userId: 'owner',
        factor: 'fixture',
        freq: 'month',
        start: '20240101',
        end: '20240102',
        legacyStatus: 'running',
      },
    });
    await prisma.strategyScanReport.create({
      data: {
        id: ids['strategy-scan'],
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Fixture',
        legacyStatus: 'running',
        config: {},
        spec: {},
        codeHash: 'hash',
      },
    });

    for (const kind of kinds) {
      await prisma.job.create({
        data: {
          id: ids[kind],
          userId: 'owner',
          kind,
          key: 'fixture',
          status: 'running',
          payload: payload(kind),
          [links[kind]]: ids[kind],
        },
      });
      JobLogs.initialize(ids[kind]);
      JobLogs.append(ids[kind], { source: 'system', level: 'info', text: 'fixture log' });
    }
  });

  it.each(['done', 'error'] as const)(
    'finishes the backtest with %s without invoking naming',
    async (outcome) => {
      if (outcome === 'done') {
        execution.worker.mockResolvedValueOnce(summary);
      } else {
        execution.worker.mockRejectedValueOnce(new Error('worker failed'));
      }

      await executeFixtureJob(ids.backtest);

      expect(execution.worker).toHaveBeenCalledOnce();
      expect(execution.rename).not.toHaveBeenCalled();
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.backtest } })).status).toBe(
        outcome,
      );
    },
  );
  afterEach(async () => {
    vi.useRealTimers();
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_job_terminal');
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_job_update');
  });
  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllEnvs();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it.each(['backtest', 'factor-analysis', 'strategy-scan'] as const)(
    'commits %s result and logs with its Job',
    async (kind) => {
      await complete(kind, 'done');
      expect(await entityStatus(kind)).toBe('done');
      const job = await prisma.job.findUniqueOrThrow({ where: { id: ids[kind] } });
      expect(job.status).toBe('done');
      expect(JSON.parse(job.logs!)).toEqual([
        { source: 'system', level: 'info', text: 'fixture log' },
      ]);
      if (kind === 'backtest') {
        expect(execution.rename).not.toHaveBeenCalled();
        expect(
          (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
        ).toEqual(summary);
        expect(
          (await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids[kind] } })).resultHash,
        ).toMatch(/^[a-f0-9]{64}$/);
      }
    },
  );

  it.each(['backtest', 'factor-analysis', 'strategy-scan'] as const)(
    'rolls back %s business writes when both completion and failure commits fail',
    async (kind) => {
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER reject_job_terminal BEFORE UPDATE OF status ON Job WHEN NEW.status IN ('done', 'error') BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
      );
      await expect(complete(kind, 'done')).rejects.toThrow();
      expect(await entityStatus(kind)).toBe('running');
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids[kind] } })).status).toBe(
        'running',
      );
      expect(
        (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
      ).toBeNull();
      expect(JobLogs.getLive(ids[kind])).toHaveLength(1);
    },
  );

  it.each(['backtest', 'factor-analysis', 'strategy-scan'] as const)(
    'records %s execution failure without writing a success payload',
    async (kind) => {
      await complete(kind, 'error');
      expect(await entityStatus(kind)).toBe('error');
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids[kind] } })).error).toBe(
        'job failure',
      );
      if (kind === 'factor-analysis') {
        expect(
          (await prisma.factorReport.findUniqueOrThrow({ where: { id: ids[kind] } }))
            .failureMessage,
        ).toBe('report failure');
      }
      if (kind === 'backtest') {
        expect(
          (await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids[kind] } })).payload,
        ).toBeNull();
        expect(
          (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
        ).toBeNull();
      }
    },
  );

  it.each([false, true])(
    'executes current queued kinds with a historical analysis discriminator: %s',
    async (hasTask) => {
      const analysisPayload = payload('factor-analysis') as Prisma.InputJsonObject;
      await prisma.job.update({
        where: { id: ids['factor-analysis'] },
        data: {
          kind: 'factor-analysis',
          status: 'queued',
          payload: hasTask ? { ...analysisPayload, task: 'analysis' } : analysisPayload,
        },
      });
      await prisma.job.create({
        data: {
          id: 'legacy-correlation',
          userId: 'owner',
          kind: 'factor-correlation',
          key: 'correlation',
          status: 'queued',
          payload: {
            task: 'correlation',
            id: 'cache',
            userId: 'owner',
            keys: ['ep', 'bp'],
            freq: 'month',
            start: '20200101',
            end: '20231229',
            locale: 'en',
          },
        },
      });

      await JobService.recoverInterrupted();
      expect(await JobService.claim(ids['factor-analysis'])).toBe(true);
      execution.worker.mockResolvedValueOnce('{"score":1}');
      await JobService.execute(ids['factor-analysis']);
      expect(await entityStatus('factor-analysis')).toBe('done');
      expect(await JobService.claim('legacy-correlation')).toBe(true);
      execution.worker.mockResolvedValueOnce('{"correlation":0.5}');
      await JobService.execute('legacy-correlation');
      expect(await prisma.factorCorrelation.findUnique({ where: { id: 'cache' } })).toMatchObject({
        payload: '{"correlation":0.5}',
      });
      expect(await prisma.job.findUnique({ where: { id: 'legacy-correlation' } })).toMatchObject({
        kind: 'factor-correlation',
        status: 'done',
      });
    },
  );

  it('recovers current running kinds with historical payloads without overwriting a successful correlation cache', async () => {
    await prisma.job.update({
      where: { id: ids['factor-analysis'] },
      data: { kind: 'factor-analysis' },
    });
    const cache = await prisma.factorCorrelation.create({
      data: { id: 'cache', userId: 'owner', payload: 'previous', computedAt: new Date() },
    });
    await prisma.job.create({
      data: {
        id: 'legacy-correlation',
        userId: 'owner',
        kind: 'factor-correlation',
        key: 'fixture',
        status: 'running',
        payload: { task: 'correlation' },
      },
    });

    await JobService.recoverInterrupted();
    expect(await entityStatus('factor-analysis')).toBe('stale');
    expect(await prisma.job.findUnique({ where: { id: 'legacy-correlation' } })).toMatchObject({
      kind: 'factor-correlation',
      status: 'stale',
    });
    expect(await prisma.factorCorrelation.findUnique({ where: { id: 'cache' } })).toEqual(cache);
    expect(execution.worker).not.toHaveBeenCalled();
  });

  it('rejects a correlation job linked to an analysis report before executing a worker', async () => {
    await prisma.job.update({
      where: { id: ids['factor-analysis'] },
      data: {
        kind: 'factor-correlation',
        payload: {
          id: 'cache',
          userId: 'owner',
          keys: ['ep', 'bp'],
          freq: 'month',
          start: '20200101',
          end: '20231229',
          locale: 'en',
        },
      },
    });
    await executeFixtureJob(ids['factor-analysis']);
    expect(execution.worker).not.toHaveBeenCalled();
    expect(await entityStatus('factor-analysis')).toBe('error');
    expect(await prisma.factorCorrelation.count()).toBe(0);
  });

  it('rolls back a successful result before recording completion failure', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_job_terminal BEFORE UPDATE OF status ON Job WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'completion rejected'); END",
    );
    await complete('backtest', 'done');
    const report = await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids.backtest } });
    expect(report).toMatchObject({
      legacyStatus: 'running',
      payload: null,
      resultHash: null,
      computedAt: null,
    });
    expect(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
    ).toBeNull();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.backtest } })).status).toBe(
      'error',
    );
  });

  it('recovers running links atomically, preserving queued jobs and completed entities', async () => {
    await prisma.job.update({ where: { id: ids['strategy-scan'] }, data: { status: 'queued' } });
    await prisma.backtestReport.update({
      where: { id: ids.backtest },
      data: { legacyStatus: 'done' },
    });
    expect(await JobService.recoverInterrupted()).toBe(kinds.length - 1);
    expect(await entityStatus('backtest')).toBe('stale');
    expect(await entityStatus('strategy-scan')).toBe('running');
    expect(await entityStatus('factor-analysis')).toBe('stale');
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: ids['strategy-scan'] } })).status,
    ).toBe('queued');
    expect(await JobService.recoverInterrupted()).toBe(0);
  });

  it('rolls back earlier recovery updates if a later entity update fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_job_update BEFORE UPDATE ON Job BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(JobService.recoverInterrupted()).rejects.toThrow();
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('running');
    }
    expect(await prisma.job.count({ where: { status: 'running' } })).toBe(kinds.length);
  });

  it.each(['signal', 'research-curator'])(
    'rejects a retired queued %s without invoking a Worker or changing other jobs',
    async (kind) => {
      const before = await prisma.job.findMany({ orderBy: { id: 'asc' } });
      await prisma.job.create({
        data: {
          id: 'retired-signal',
          userId: 'owner',
          kind,
          key: 'old-run',
          status: 'queued',
          payload: { task: 'signal', runId: 'old-run' },
        },
      });

      await executeFixtureJob('retired-signal');

      expect(await prisma.job.findUniqueOrThrow({ where: { id: 'retired-signal' } })).toMatchObject(
        {
          status: 'error',
          error: `Unsupported queued job kind: ${kind}`,
          finishedAt: expect.any(Date),
        },
      );
      expect(execution.worker).not.toHaveBeenCalled();
      expect(
        await prisma.job.findMany({
          where: { id: { not: 'retired-signal' } },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(before);
    },
  );

  it('fails every persisted link atomically even with corrupt kind and payload', async () => {
    await prisma.job.deleteMany();
    await prisma.job.create({
      data: {
        id: 'broken',
        userId: 'owner',
        kind: 'unknown',
        key: 'fixture',
        status: 'running',
        factorReportId: ids['factor-analysis'],
        backtestReportId: ids.backtest,
        strategyScanReportId: ids['strategy-scan'],
      },
    });
    await prisma.job.update({ where: { id: 'broken' }, data: { status: 'queued' } });
    expect(await JobService.claim('broken')).toBe(true);
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_job_update BEFORE UPDATE ON Job BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(JobService.execute('broken')).rejects.toThrow();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: 'broken' } })).status).toBe(
      'running',
    );
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('running');
    }
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_job_update');
    await executeFixtureJob('broken');
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('error');
    }
    expect(execution.worker).not.toHaveBeenCalled();
    expect(await JobService.claim('missing')).toBe(false);
    await expect(JobService.execute('missing')).rejects.toThrow('locally owned claim');
  });

  it.each([null, [], { task: 'invalid' }])(
    'rejects invalid persisted input %j before execution',
    async (raw) => {
      await prisma.job.update({
        where: { id: ids.backtest },
        data: { payload: raw === null ? prismaValues.DbNull : raw },
      });
      await executeFixtureJob(ids.backtest);
      expect(execution.worker).not.toHaveBeenCalled();
      expect(await entityStatus('backtest')).toBe('error');
    },
  );

  it('does not resolve prototype properties as registered task kinds', async () => {
    await prisma.job.update({ where: { id: ids.backtest }, data: { kind: 'toString' } });
    await executeFixtureJob(ids.backtest);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.backtest } })).error).toBe(
      'Unsupported queued job kind: toString',
    );
    expect(await entityStatus('backtest')).toBe('error');
  });

  it.each(['success', 'failed-create', 'failed-overwrite'] as const)(
    'commits correlation cache with its Job: %s',
    async (scenario) => {
      await prisma.job.create({
        data: {
          id: 'correlation-job',
          userId: 'owner',
          kind: 'factor-correlation',
          key: 'correlation',
          status: 'running',
          payload: {
            id: 'correlation-cache',
            userId: 'owner',
            keys: ['a', 'b'],
            freq: 'month',
            start: '20240101',
            end: '20240201',
            locale: 'en',
          },
        },
      });
      const previousTime = new Date('2024-01-01T00:00:00Z');
      if (scenario === 'failed-overwrite') {
        await prisma.factorCorrelation.create({
          data: {
            id: 'correlation-cache',
            userId: 'owner',
            payload: 'previous',
            computedAt: previousTime,
          },
        });
      }
      if (scenario !== 'success') {
        await prisma.$executeRawUnsafe(
          "CREATE TRIGGER reject_job_terminal BEFORE UPDATE OF status ON Job WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'completion rejected'); END",
        );
      }
      execution.worker.mockResolvedValueOnce('{"correlation":0.5}');
      await executeFixtureJob('correlation-job');
      const cache = await prisma.factorCorrelation.findUnique({
        where: { id: 'correlation-cache' },
      });
      switch (scenario) {
        case 'success':
          expect(cache?.payload).toBe('{"correlation":0.5}');
          break;
        case 'failed-create':
          expect(cache).toBeNull();
          break;
        case 'failed-overwrite':
          expect(cache).toMatchObject({ payload: 'previous', computedAt: previousTime });
          break;
      }
      expect(await prisma.job.findUnique({ where: { id: 'correlation-job' } })).toMatchObject({
        status: scenario === 'success' ? 'done' : 'error',
      });
      expect(await entityStatus('factor-analysis')).toBe('running');
    },
  );

  it('does not execute completed jobs again or overwrite their result', async () => {
    await complete('backtest', 'done');
    expect(await JobService.claim(ids.backtest)).toBe(false);
    await expect(JobService.execute(ids.backtest)).rejects.toThrow('locally owned claim');
    expect(execution.worker).toHaveBeenCalledOnce();
    expect(await entityStatus('backtest')).toBe('done');
  });

  it('persists logs and reads them after eviction while enforcing ownership', async () => {
    const id = ids['factor-analysis'];
    expect(await JobService.get('other-owner', id)).toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await complete('factor-analysis', 'done');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(JobLogs.getLive(id)).toBeUndefined();
    expect((await JobService.get('owner', id))?.logs).toHaveLength(1);
    expect((await JobService.get('owner', id, 1))?.logs).toEqual([]);
    await prisma.job.update({ where: { id }, data: { logs: 'invalid json' } });
    expect((await JobService.get('owner', id))?.logs).toEqual([]);
  });

  it('claims a queued job at most once', async () => {
    await prisma.job.update({ where: { id: ids['factor-analysis'] }, data: { status: 'queued' } });
    const claims = await Promise.all([
      JobService.claim(ids['factor-analysis']),
      JobService.claim(ids['factor-analysis']),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    execution.worker.mockResolvedValueOnce('{"score":1}');
    await JobService.execute(ids['factor-analysis']);
  });
  it('allows repeated identical registration but rejects replacing an active contract', () => {
    expect(() => registerJobLifecycles()).not.toThrow();
    expect(() => JobService.register('backtest', { ...strategyBacktestLifecycle })).toThrow(
      'Job lifecycle already registered: backtest',
    );
  });

  it('automatically commits the result returned by onExecute', async () => {
    const result = {
      reportId: ids.backtest,
      strategyId: 'strategy',
      payload: {},
      resultHash: 'hash',
    };
    const execute = vi.spyOn(strategyBacktestLifecycle, 'onExecute').mockResolvedValueOnce(result);
    const success = vi.spyOn(strategyBacktestLifecycle, 'onSuccess');
    try {
      await executeFixtureJob(ids.backtest);
      expect(success).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: ids.backtest }),
        result,
      );
      expect(await prisma.job.findUnique({ where: { id: ids.backtest } })).toMatchObject({
        status: 'done',
        error: null,
      });
      expect(await prisma.backtestReport.findUnique({ where: { id: ids.backtest } })).toMatchObject(
        {
          payload: result.payload,
          resultHash: result.resultHash,
          computedAt: expect.any(Date),
        },
      );
    } finally {
      execute.mockRestore();
      success.mockRestore();
    }
  });

  it('keeps terminal logs frozen after late callbacks', async () => {
    await complete('backtest', 'done');
    const before = await JobService.get('owner', ids.backtest);
    JobLogs.append(ids.backtest, { source: 'system', level: 'error', text: 'late' });
    expect(await JobService.get('owner', ids.backtest)).toEqual(before);
  });
});

registerJobLifecycles();

/**
 * 旧运行态 fixture 同时用于恢复测试；执行前显式重新入队并取得真实所有权。
 *
 * Running fixtures also cover recovery; explicitly enqueue and claim before execution.
 */
async function executeFixtureJob(jobId: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'queued' } });
  expect(await JobService.claim(jobId)).toBe(true);

  await JobService.execute(jobId);
}
