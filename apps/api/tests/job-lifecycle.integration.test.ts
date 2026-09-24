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
vi.mock('#jobs/worker.js', () => ({ runWorker: execution.worker }));
vi.mock('#strategy/definitions/naming.js', () => ({
  refreshStrategyName: execution.rename,
}));
vi.mock('#research/curator/prepare.js', () => ({ prepareResearchCuratorRun: execution.curator }));
vi.mock('#signals/runs/notifier.js', () => ({ notifySignalRun: execution.notify }));
vi.mock('#signals/accounting/initialize.js', () => ({
  initializeSignalAccounting: execution.accounting,
}));

import { prisma } from '#infra/database/prisma.js';
import { completedSignalRunIds } from '#signals/runs/state.js';
import type { PreparedResearchCuratorRun } from '#research/curator/prepare.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { strategyBacktestLifecycle } from '#strategy/backtests/job-lifecycle.js';
import { JobLogs } from '#jobs/logs.js';
import { JobService } from '#jobs/service.js';

const kinds = [
  'backtest',
  'factor-analysis',
  'strategy-scan',
  'signal',
  'research-curator',
] as const;
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
  signal: 'signalRunId',
  'research-curator': 'researchCuratorRunId',
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

async function complete(kind: Kind, status: 'done' | 'error') {
  if (status === 'done' && kind === 'backtest') {
    execution.worker.mockResolvedValueOnce(summary);
  }
  if (status === 'done' && kind === 'factor-analysis') {
    execution.worker.mockResolvedValueOnce('{"score":1}');
  }
  if (status === 'error') {
    if (kind === 'research-curator') {
      execution.curator.mockRejectedValueOnce(new Error('job failure'));
    } else {
      execution.worker.mockRejectedValueOnce(new Error('job failure'));
    }
  }
  return JobService.execute(ids[kind]);
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
    execution.worker.mockReset().mockResolvedValue({
      ...summary,
      cells: [],
      dataCutoff: '20240101',
      modelEquity: 101,
      modelCash: 50,
      modelPositions: [],
      signals: [],
      factorInputs: [],
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
    await prisma.signalRun.create({
      data: {
        id: ids.signal,
        userId: 'owner',
        deploymentId: 'deployment',
        strategyId: 'strategy',
        tradeDate: '20240101',
        execDate: '20240102',
        legacyStatus: 'running',
      },
    });
    await prisma.researchCuratorRun.create({
      data: {
        id: ids['research-curator'],
        userId: 'owner',
        cursorTo: new Date(),
        legacyStatus: 'running',
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

      await JobService.execute(ids.backtest);

      expect(execution.worker).toHaveBeenCalledOnce();
      expect(execution.rename).not.toHaveBeenCalled();
      expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.backtest } })).status).toBe(
        outcome,
      );
    },
  );

  it('filters completed Signals by latest timestamp/id before pagination and counts', async () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    await prisma.job.update({ where: { id: ids.signal }, data: { status: 'done', createdAt } });
    expect(await completedSignalRunIds({ deploymentId: 'deployment' })).toEqual([ids.signal]);
    const latestId = `zz-${sequence}`;
    await prisma.job.create({
      data: {
        id: latestId,
        userId: 'owner',
        kind: 'signal',
        key: 'retry',
        status: 'error',
        signalRunId: ids.signal,
        createdAt,
      },
    });
    expect(await completedSignalRunIds({ deploymentId: 'deployment' })).toEqual([]);
    await prisma.job.update({ where: { id: latestId }, data: { status: 'queued' } });
    expect(await completedSignalRunIds({})).toEqual([]);
    await prisma.job.update({ where: { id: latestId }, data: { status: 'done' } });
    expect(await completedSignalRunIds({ afterDate: '20240102' })).toEqual([]);
    expect(await completedSignalRunIds({ throughDate: '20240101' })).toEqual([]);
    expect(await completedSignalRunIds({ deploymentId: 'other' })).toEqual([]);
    expect(await completedSignalRunIds({ throughDate: '20240102' })).toEqual([ids.signal]);
    await prisma.job.deleteMany({ where: { signalRunId: ids.signal } });
    await prisma.signalRun.update({ where: { id: ids.signal }, data: { legacyStatus: 'done' } });
    expect(await completedSignalRunIds({})).toEqual([ids.signal]);
    await prisma.signalRun.update({ where: { id: ids.signal }, data: { legacyStatus: 'error' } });
    expect(await completedSignalRunIds({})).toEqual([]);
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

  it.each(['backtest', 'factor-analysis', 'strategy-scan', 'signal'] as const)(
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

  it.each(['backtest', 'factor-analysis', 'strategy-scan', 'signal'] as const)(
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

  it.each(['backtest', 'factor-analysis', 'strategy-scan', 'signal'] as const)(
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
    await JobService.execute(ids['factor-analysis']);
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
    await prisma.job.update({ where: { id: ids.signal }, data: { status: 'queued' } });
    await prisma.backtestReport.update({
      where: { id: ids.backtest },
      data: { legacyStatus: 'done' },
    });
    expect(await JobService.recoverInterrupted()).toBe(4);
    expect(await entityStatus('backtest')).toBe('stale');
    expect(await entityStatus('signal')).toBe('running');
    for (const kind of ['factor-analysis', 'strategy-scan', 'research-curator'] as const) {
      expect(await entityStatus(kind)).toBe('stale');
    }
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ids.signal } })).status).toBe(
      'queued',
    );
    expect(await JobService.recoverInterrupted()).toBe(0);
  });

  it('rolls back earlier recovery updates if a later entity update fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON Job BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(JobService.recoverInterrupted()).rejects.toThrow();
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
        factorReportId: ids['factor-analysis'],
        backtestReportId: ids.backtest,
        strategyScanReportId: ids['strategy-scan'],
        signalRunId: ids.signal,
        researchCuratorRunId: ids['research-curator'],
      },
    });
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON Job BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    await expect(JobService.execute('broken')).rejects.toThrow();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: 'broken' } })).status).toBe(
      'running',
    );
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('running');
    }
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_curator_update');
    await JobService.execute('broken');
    for (const kind of kinds) {
      expect(await entityStatus(kind)).toBe('error');
    }
    expect(execution.worker).not.toHaveBeenCalled();
    await expect(JobService.execute('missing')).resolves.toBeUndefined();
  });

  it.each([null, [], { task: 'invalid' }])(
    'rejects invalid persisted input %j before execution',
    async (raw) => {
      await prisma.job.update({
        where: { id: ids.backtest },
        data: { payload: raw === null ? prismaValues.DbNull : raw },
      });
      await JobService.execute(ids.backtest);
      expect(execution.worker).not.toHaveBeenCalled();
      expect(await entityStatus('backtest')).toBe('error');
    },
  );

  it('does not resolve prototype properties as registered task kinds', async () => {
    await prisma.job.update({ where: { id: ids.backtest }, data: { kind: 'toString' } });
    await JobService.execute(ids.backtest);
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
    ).toMatchObject({
      legacyStatus: 'running',
      evidenceCount: 4,
      findingsCreated: 3,
      duplicatesSkipped: 0,
    });
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
      legacyStatus: 'running',
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
      data: { id: 'earlier-run', userId: 'owner', legacyStatus: 'done', cursorTo: new Date() },
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
    ).toMatchObject({ legacyStatus: 'running', findingsCreated: 2, duplicatesSkipped: 2 });
    expect(await prisma.researchCuratorFinding.count()).toBe(3);
    expect(
      await prisma.researchCuratorFinding.findUnique({ where: { id: 'earlier-finding' } }),
    ).toMatchObject({ runId: 'earlier-run' });
  });

  it('does not publish Curator candidates if the final run update fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_curator_update BEFORE UPDATE ON ResearchCuratorRun WHEN NEW.findingsCreated > 0 BEGIN SELECT RAISE(ABORT, 'run completion rejected'); END",
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
      await JobService.execute('correlation-job');
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
        expect.objectContaining({ jobId: ids.signal }),
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
    await JobService.execute(ids.signal);
    expect(execution.worker).not.toHaveBeenCalled();
    expect(execution.notify).not.toHaveBeenCalled();
    expect(await entityStatus('signal')).toBe('error');
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
      await JobService.execute(ids.backtest);
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

  it('rejects an older Signals attempt after a same-time retry with a greater id', async () => {
    const old = await prisma.job.findUniqueOrThrow({ where: { id: ids.signal } });
    execution.worker.mockImplementationOnce(async () => {
      await prisma.job.create({
        data: {
          id: old.id + '-new',
          userId: 'owner',
          kind: 'signal',
          key: old.key,
          status: 'queued',
          signalRunId: ids.signal,
          createdAt: old.createdAt,
          payload: { task: 'signal', runId: ids.signal, locale: 'en' },
        },
      });
      return {
        dataCutoff: '20240101',
        modelEquity: 100,
        modelCash: 100,
        modelPositions: [],
        signals: [],
        factorInputs: [],
      };
    });
    await JobService.execute(old.id);
    expect(await prisma.job.findUnique({ where: { id: old.id } })).toMatchObject({
      status: 'error',
    });
    expect(await prisma.job.findUnique({ where: { id: old.id + '-new' } })).toMatchObject({
      status: 'queued',
    });
    expect(await prisma.signalRun.findUnique({ where: { id: ids.signal } })).toMatchObject({
      modelEquity: null,
    });
    expect(execution.accounting).not.toHaveBeenCalled();
    expect(execution.notify).not.toHaveBeenCalled();
  });
});

registerJobLifecycles();
