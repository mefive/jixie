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
  return { prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});
const execution = vi.hoisted(() => ({
  worker: vi.fn(),
  rename: vi.fn(),
  curator: vi.fn(),
  notify: vi.fn(),
  accounting: vi.fn(),
}));
vi.mock('../src/server.js', () => ({ buildApp: vi.fn() }));
vi.mock('#infra/jobs/worker-result.js', () => ({ runJobWorker: execution.worker }));
vi.mock('#strategy/definitions/config.js', () => ({
  strategyRunKey: () => 'fixture',
}));
vi.mock('#strategy/definitions/naming.js', () => ({
  refreshStrategyName: execution.rename,
}));
vi.mock('#research/curator/runs.js', () => ({ prepareResearchCuratorRun: execution.curator }));
vi.mock('#signals/notifier.js', () => ({ notifySignalRun: execution.notify }));
vi.mock('#signals/accounting/initialize.js', () => ({
  initializeSignalAccounting: execution.accounting,
}));

import { prisma } from '#infra/database/prisma.js';
import type { PreparedResearchCuratorRun } from '#research/curator/runs.js';
import { jobRegistry } from '../src/bootstrap.js';
import { createJobExecutor } from '#infra/jobs/executor.js';
import { appendLog, initializeJobLogs, getLiveJobLogs } from '#infra/jobs/logs.js';
import { claimQueuedJob, getJob } from '#infra/jobs/records.js';

const kinds = ['backtest', 'factor', 'strategy-scan', 'signal', 'research-curator'] as const;
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

async function entityStatus(kind: Kind): Promise<string> {
  switch (kind) {
    case 'backtest':
      return (await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids[kind] } })).status;
    case 'factor':
      return (await prisma.factorReport.findUniqueOrThrow({ where: { id: ids[kind] } })).status;
    case 'strategy-scan':
      return (await prisma.strategyScanReport.findUniqueOrThrow({ where: { id: ids[kind] } }))
        .status;
    case 'signal':
      return (await prisma.signalRun.findUniqueOrThrow({ where: { id: ids[kind] } })).status;
    case 'research-curator':
      return (await prisma.researchCuratorRun.findUniqueOrThrow({ where: { id: ids[kind] } }))
        .status;
  }
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
    case 'factor':
      return {
        task: 'analysis',
        reportId: ids.factor,
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
    case 'signal':
      return { task: 'signal', runId: ids.signal, locale: 'en' };
    case 'research-curator':
      return { runId: ids['research-curator'] };
  }
}
function preparedCuratorRun(runId: string): PreparedResearchCuratorRun {
  return {
    runId,
    userId: 'owner',
    evidenceCount: 4,
    findings: ['a', 'b', 'c'].map((key) => ({
      id: `${runId}-${key}`,
      userId: 'owner',
      runId,
      category: 'documentation_gap',
      title: `Finding ${key}`,
      summary: 'Fixture',
      evidence: [],
      verification: {},
      confidence: 0.8,
      expectedValue: 'Fixture',
      changeSurface: [],
      suggestedAction: 'Review',
      fingerprint: `finding-${key}`,
    })),
  };
}

const executor = createJobExecutor(jobRegistry);
async function complete(kind: Kind, status: 'done' | 'error') {
  if (status === 'error') {
    if (kind === 'research-curator') {
      execution.curator.mockRejectedValueOnce(new Error('job failure'));
    } else {
      execution.worker.mockRejectedValueOnce(new Error('job failure'));
    }
  }
  return executor.execute(ids[kind]);
}

describe('durable job and business lifecycle transactions', () => {
  beforeAll(() => {
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
    execution.worker.mockReset().mockImplementation(async ({ context }) => {
      switch (context.job.kind) {
        case 'backtest':
          return summary;
        case 'factor':
          return '{"score":1}';
        case 'strategy-scan':
          return { cells: [] };
        case 'signal':
          return {
            dataCutoff: '20240101',
            modelEquity: 101,
            modelCash: 50,
            modelPositions: [],
            signals: [],
            factorInputs: [],
          };
      }
    });
    execution.rename.mockReset().mockResolvedValue(false);
    execution.curator.mockReset().mockImplementation(async (runId) => preparedCuratorRun(runId));
    execution.notify.mockReset().mockResolvedValue(undefined);
    execution.accounting.mockReset().mockResolvedValue(undefined);
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
    await prisma.strategyDeployment.create({
      data: {
        id: 'deployment',
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Fixture',
        status: 'active',
        config: {},
        codeHash: 'hash',
        locale: 'en',
      },
    });
    await prisma.backtestReport.create({
      data: {
        id: ids.backtest,
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Fixture',
        status: 'running',
        config: {},
      },
    });
    await prisma.factorReport.create({
      data: {
        id: ids.factor,
        userId: 'owner',
        factor: 'fixture',
        freq: 'month',
        start: '20240101',
        end: '20240102',
        status: 'running',
      },
    });
    await prisma.strategyScanReport.create({
      data: {
        id: ids['strategy-scan'],
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: 'Fixture',
        status: 'running',
        config: {},
        spec: {},
        codeHash: 'hash',
      },
    });
    await prisma.signalRun.create({
      data: {
        id: ids.signal,
        userId: 'owner',
        deploymentId: 'deployment',
        strategyId: 'strategy',
        tradeDate: '20240101',
        execDate: '20240102',
        status: 'running',
      },
    });
    await prisma.researchCuratorRun.create({
      data: {
        id: ids['research-curator'],
        userId: 'owner',
        cursorTo: new Date(),
        status: 'running',
      },
    });
    const links = {
      backtest: 'backtestReportId',
      factor: 'factorReportId',
      'strategy-scan': 'strategyScanReportId',
      signal: 'signalRunId',
      'research-curator': 'researchCuratorRunId',
    };
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
      initializeJobLogs(ids[kind]);
      appendLog(ids[kind], { source: 'system', level: 'info', text: 'fixture log' });
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_job_terminal');
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_curator_update');
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it.each(['backtest', 'factor', 'strategy-scan', 'signal'] as const)(
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
        expect(execution.rename).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'strategy', userId: 'owner', expectedRunKey: 'fixture' }),
        );
        expect(
          (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
        ).toEqual(summary);
        expect(
          (await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids[kind] } })).resultHash,
        ).toMatch(/^[a-f0-9]{64}$/);
      }
    },
  );

  it.each(['backtest', 'factor', 'strategy-scan', 'signal'] as const)(
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
      expect(getLiveJobLogs(ids[kind])).toHaveLength(1);
    },
  );

  it.each(['backtest', 'factor', 'strategy-scan', 'signal'] as const)(
    'records %s execution failure without writing a success payload',
    async (kind) => {
      await complete(kind, 'error');
      expect(await entityStatus(kind)).toBe('error');
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids[kind] } })).error).toBe(
        'job failure',
      );
      if (kind === 'factor') {
        expect(
          (await prisma.factorReport.findUniqueOrThrow({ where: { id: ids[kind] } })).error,
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

  it('rolls back a successful result before recording completion failure', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_job_terminal BEFORE UPDATE OF status ON Job WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'completion rejected'); END",
    );
    await complete('backtest', 'done');
    const report = await prisma.backtestReport.findUniqueOrThrow({ where: { id: ids.backtest } });
    expect(report).toMatchObject({
      status: 'error',
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
    await prisma.job.update({ where: { id: ids.signal }, data: { status: 'queued' } });
    await prisma.backtestReport.update({ where: { id: ids.backtest }, data: { status: 'done' } });
    expect(await executor.recoverInterruptedJobs()).toBe(4);
    expect(await entityStatus('backtest')).toBe('done');
    expect(await entityStatus('signal')).toBe('running');
    for (const kind of ['factor', 'strategy-scan', 'research-curator'] as const) {
      expect(await entityStatus(kind)).toBe('stale');
    }
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.signal } })).status).toBe(
      'queued',
    );
    expect(await executor.recoverInterruptedJobs()).toBe(0);
  });

  it('rolls back earlier recovery updates if a later entity update fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON ResearchCuratorRun BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(executor.recoverInterruptedJobs()).rejects.toThrow();
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('running');
    }
    expect(await prisma.job.count({ where: { status: 'running' } })).toBe(5);
  });

  it('fails every persisted link atomically even with corrupt kind and payload', async () => {
    await prisma.job.deleteMany();
    await prisma.job.create({
      data: {
        id: 'broken',
        userId: 'owner',
        kind: 'unknown',
        key: 'fixture',
        status: 'running',
        factorReportId: ids.factor,
        backtestReportId: ids.backtest,
        strategyScanReportId: ids['strategy-scan'],
        signalRunId: ids.signal,
        researchCuratorRunId: ids['research-curator'],
      },
    });
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON ResearchCuratorRun BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(executor.execute('broken')).rejects.toThrow();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: 'broken' } })).status).toBe(
      'running',
    );
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('running');
    }
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_curator_update');
    await executor.execute('broken');
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('error');
    }
    expect(execution.worker).not.toHaveBeenCalled();
    await expect(executor.execute('missing')).resolves.toBeUndefined();
  });

  it.each([null, [], { task: 'invalid' }])(
    'rejects invalid persisted input %j before execution',
    async (raw) => {
      await prisma.job.update({
        where: { id: ids.backtest },
        data: { payload: raw === null ? prismaValues.DbNull : raw },
      });
      await executor.execute(ids.backtest);
      expect(execution.worker).not.toHaveBeenCalled();
      expect(await entityStatus('backtest')).toBe('error');
    },
  );

  it('does not resolve prototype properties as registered task kinds', async () => {
    await prisma.job.update({ where: { id: ids.backtest }, data: { kind: 'toString' } });
    await executor.execute(ids.backtest);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.backtest } })).error).toBe(
      'Unsupported queued job kind: toString',
    );
    expect(await entityStatus('backtest')).toBe('error');
  });

  it('commits Curator findings, statistics, run and Job together', async () => {
    await complete('research-curator', 'done');
    expect(await prisma.researchCuratorFinding.count()).toBe(3);
    expect(
      await prisma.researchCuratorRun.findUnique({ where: { id: ids['research-curator'] } }),
    ).toMatchObject({ status: 'done', evidenceCount: 4, findingsCreated: 3, duplicatesSkipped: 0 });
    expect(await prisma.job.findUnique({ where: { id: ids['research-curator'] } })).toMatchObject({
      status: 'done',
    });
  });

  it('rolls back every Curator finding and statistic when Job completion fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_job_terminal BEFORE UPDATE OF status ON Job WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'completion rejected'); END",
    );
    await complete('research-curator', 'done');
    expect(await prisma.researchCuratorFinding.count()).toBe(0);
    expect(
      await prisma.researchCuratorRun.findUnique({ where: { id: ids['research-curator'] } }),
    ).toMatchObject({
      status: 'error',
      evidenceCount: 0,
      findingsCreated: 0,
      duplicatesSkipped: 0,
    });
    expect(await prisma.job.findUnique({ where: { id: ids['research-curator'] } })).toMatchObject({
      status: 'error',
    });
  });

  it('rechecks persisted fingerprints at commit time and deduplicates within the candidate batch', async () => {
    await prisma.researchCuratorRun.create({
      data: { id: 'earlier-run', userId: 'owner', status: 'done', cursorTo: new Date() },
    });
    execution.curator.mockImplementationOnce(async (runId) => {
      const prepared = preparedCuratorRun(runId);
      // Simulate another publication after candidate preparation, before this completion transaction.
      await prisma.researchCuratorFinding.create({
        data: { ...prepared.findings[0]!, id: 'earlier-finding', runId: 'earlier-run' },
      });
      prepared.findings.push({ ...prepared.findings[1]!, id: 'duplicate-in-batch' });
      return prepared;
    });
    await complete('research-curator', 'done');
    expect(
      await prisma.researchCuratorRun.findUnique({ where: { id: ids['research-curator'] } }),
    ).toMatchObject({ status: 'done', findingsCreated: 2, duplicatesSkipped: 2 });
    expect(await prisma.researchCuratorFinding.count()).toBe(3);
    expect(
      await prisma.researchCuratorFinding.findUnique({ where: { id: 'earlier-finding' } }),
    ).toMatchObject({ runId: 'earlier-run' });
  });

  it('does not publish Curator candidates if the final run update fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON ResearchCuratorRun WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'run completion rejected'); END",
    );
    await complete('research-curator', 'done');
    expect(await prisma.researchCuratorFinding.count()).toBe(0);
    expect(await entityStatus('research-curator')).toBe('error');
  });

  it('finalizes active Curator failure and Job logs in one failure transaction', async () => {
    await complete('research-curator', 'error');
    expect(await entityStatus('research-curator')).toBe('error');
    const job = await prisma.job.findUniqueOrThrow({ where: { id: ids['research-curator'] } });
    expect(job).toMatchObject({ status: 'error', error: 'job failure' });
    expect(JSON.parse(job.logs!).length).toBeGreaterThan(0);
  });

  it.each(['success', 'failed-create', 'failed-overwrite'] as const)(
    'commits correlation cache with its Job: %s',
    async (scenario) => {
      await prisma.job.create({
        data: {
          id: 'correlation-job',
          userId: 'owner',
          kind: 'factor',
          key: 'correlation',
          status: 'running',
          payload: {
            task: 'correlation',
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
      await executor.execute('correlation-job');
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
      expect(await entityStatus('factor')).toBe('running');
    },
  );

  it('does not execute completed jobs again or overwrite their result', async () => {
    await complete('backtest', 'done');
    await complete('backtest', 'done');
    expect(execution.worker).toHaveBeenCalledOnce();
    expect(await entityStatus('backtest')).toBe('done');
  });

  it('keeps post-commit failure separate from the successful task state', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      execution.accounting.mockRejectedValueOnce(new Error('accounting failed'));
      await complete('signal', 'done');
      expect(await entityStatus('signal')).toBe('done');
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.signal } })).status).toBe(
        'done',
      );
      expect(execution.notify).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        '[jixie] job post-commit action failed',
        expect.objectContaining({ jobId: ids.signal, status: 'done' }),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('does not notify a payload run that differs from the persisted link', async () => {
    await prisma.job.update({
      where: { id: ids.signal },
      data: { payload: { task: 'signal', runId: 'wrong-run', locale: 'en' } },
    });
    await executor.execute(ids.signal);
    expect(execution.worker).not.toHaveBeenCalled();
    expect(execution.notify).not.toHaveBeenCalled();
    expect(await entityStatus('signal')).toBe('error');
  });

  it('persists logs and reads them after eviction while enforcing ownership', async () => {
    const id = ids.factor;
    expect(await getJob('other-owner', id)).toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await complete('factor', 'done');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getLiveJobLogs(id)).toBeUndefined();
    expect((await getJob('owner', id))?.logs).toHaveLength(1);
    expect((await getJob('owner', id, 1))?.logs).toEqual([]);
    await prisma.job.update({ where: { id }, data: { logs: 'invalid json' } });
    expect((await getJob('owner', id))?.logs).toEqual([]);
  });

  it('claims a queued job at most once', async () => {
    await prisma.job.update({ where: { id: ids.factor }, data: { status: 'queued' } });
    const claims = await Promise.all([claimQueuedJob(ids.factor), claimQueuedJob(ids.factor)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
