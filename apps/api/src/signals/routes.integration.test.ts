import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '', sequence: 0 }));
const resources = vi.hoisted(() => ({
  id: vi.fn(),
  metadata: vi.fn(),
  factors: vi.fn(),
  yieldReady: vi.fn(),
  wake: vi.fn(),
  completion: vi.fn(),
}));
vi.mock('ulid', () => ({ ulid: resources.id }));
vi.mock('../infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-signals-http-');
  const database = `${fixture.directory}/signals.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});
vi.mock('../strategy/runtime/typescript/walled-run.js', () => ({
  inspectWalledStrategyMetadata: resources.metadata,
}));
vi.mock('../strategy/execution/prepare-factors.js', () => ({
  prepareStrategyFactors: resources.factors,
}));
vi.mock('../market/rates/signal-readiness.js', () => ({
  governmentYieldCurveReady: resources.yieldReady,
}));
vi.mock('../infra/jobs/queue.js', () => ({
  wakeJobQueue: resources.wake,
  waitForJobCompletion: resources.completion,
}));

import { prisma } from '../infra/database/prisma.js';
import { t } from '../i18n/index.js';
import { deleteStrategy } from '../strategy/definitions/drafts.js';
import { routes } from './routes.js';
import { deployBacktestReport } from './deployments/manage.js';
import { enqueueSignalRun } from './runs/enqueue.js';
import { initializeSignalAccounting } from './accounting/initialize.js';
import { settleStrategyAccounts } from './accounting/settlement.js';

const config = {
  name: 'Signal fixture',
  start: '20240102',
  end: '20240105',
  initialCash: 100_000,
  code: 'export default defineStrategy({ watch: ["000001.SZ"], onBar() {} });',
  cost: { slippageBps: 0, impactCoef: 0 },
};
const dependencies = [
  {
    factorId: 'factor',
    key: 'quality',
    name: 'Quality',
    analysisKind: 'cross_sectional',
    codeHash: 'frozen-factor',
    approvedReportId: 'approved',
    inputs: ['daily'],
  },
];
const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/signals', routes);
function request(path: string, body?: unknown, userId = 'owner', method = 'POST') {
  return app.request(`/signals${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      'x-fixture-user': userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function deploy(reportId = 'report') {
  const result = await deployBacktestReport('owner', reportId, 'en');
  if (result.kind !== 'ready') {
    throw new Error(`Unexpected deployment result: ${result.kind}`);
  }
  return result.deployment;
}
async function createReport(id: string, reportConfig = config) {
  return prisma.backtestReport.create({
    data: {
      id,
      userId: 'owner',
      strategyId: 'strategy',
      strategyName: reportConfig.name,
      status: 'done',
      config: reportConfig,
      payload: { factorDependencies: dependencies },
    },
  });
}
async function enqueue(deploymentId: string) {
  const result = await enqueueSignalRun('owner', deploymentId, '20240103');
  if (result.kind !== 'ready') {
    throw new Error(`Unexpected enqueue result: ${result.kind}`);
  }
  return result.run;
}

describe('Signals HTTP and persistence boundaries', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/signals.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    vi.clearAllMocks();
    resources.id.mockReset().mockImplementation(() => `signals-${++fixture.sequence}`);
    resources.metadata.mockReset().mockResolvedValue({ watch: [], futures: [], factors: [] });
    resources.factors.mockReset().mockResolvedValue({ modules: [], factors: dependencies });
    resources.yieldReady.mockReset().mockResolvedValue(true);
    resources.completion.mockReset().mockResolvedValue('done');
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'signals-owner@fixture.invalid' },
        { id: 'other', email: 'signals-other@fixture.invalid' },
      ],
    });
    await prisma.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: config.name,
        config,
        lastResult: { marker: 'backtest' },
      },
    });
    await createReport('report');
    const dates = ['20240102', '20240103', '20240104', '20240105'];
    await prisma.tradeCal.createMany({
      data: dates.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
    });
    await prisma.daily.createMany({
      data: dates.map((tradeDate) => ({
        tsCode: '000001.SZ',
        tradeDate,
        open: 10,
        close: 10.5,
        amount: 100_000,
      })),
    });
    await prisma.adjFactor.createMany({
      data: dates.map((tradeDate) => ({ tsCode: '000001.SZ', tradeDate, adjFactor: 1 })),
    });
    await prisma.dailyBasic.createMany({
      data: dates.map((tradeDate) => ({ tsCode: '000001.SZ', tradeDate, pb: 1 })),
    });
    await prisma.stkLimit.createMany({
      data: dates.map((tradeDate) => ({
        tsCode: '000001.SZ',
        tradeDate,
        upLimit: 11,
        downLimit: 9,
      })),
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await prisma.user.deleteMany();
    await prisma.tradeCal.deleteMany();
    await prisma.daily.deleteMany();
    await prisma.adjFactor.deleteMany();
    await prisma.dailyBasic.deleteMany();
    await prisma.stkLimit.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('enforces report ownership, completed evidence, language and asset restrictions', async () => {
    expect((await request('/deployments', { reportId: 'report' }, 'other')).status).toBe(404);
    expect((await request('/deployments', { strategyId: 'strategy' })).status).toBe(400);
    expect((await request('/deployments', { reportId: 'missing' })).status).toBe(404);
    await prisma.backtestReport.create({
      data: {
        id: 'empty-report',
        userId: 'owner',
        strategyId: 'strategy',
        strategyName: config.name,
        status: 'done',
        config,
      },
    });
    expect((await request('/deployments', { reportId: 'empty-report' })).status).toBe(400);
    for (const status of ['running', 'error', 'stale']) {
      await prisma.backtestReport.update({ where: { id: 'report' }, data: { status } });
      const response = await request('/deployments', { reportId: 'report' });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { message: t('en', 'deploymentReportNotReady') },
      });
    }
    await prisma.backtestReport.update({
      where: { id: 'report' },
      data: {
        status: 'done',
        config: { ...config, language: 'python', runtimeVersion: 'py-v1' },
      },
    });
    expect((await request('/deployments', { reportId: 'report' })).status).toBe(400);
    expect(resources.metadata).not.toHaveBeenCalled();
    await prisma.backtestReport.update({ where: { id: 'report' }, data: { config } });
    resources.metadata.mockResolvedValue({ watch: [], futures: ['IF.CFX'], factors: [] });
    expect((await request('/deployments', { reportId: 'report' })).status).toBe(400);
    expect(resources.factors).not.toHaveBeenCalled();
    expect(await prisma.strategyDeployment.count()).toBe(0);
  });

  it('freezes the report despite later draft edits and independently deploys identical reports', async () => {
    await prisma.strategy.update({
      where: { id: 'strategy' },
      data: {
        name: 'Revised',
        config: { ...config, code: 'changed draft', initialCash: 200_000 },
      },
    });
    const first = await deploy();
    expect(first).toMatchObject({
      backtestReportId: 'report',
      strategyName: config.name,
      config,
      factorDependencies: dependencies,
    });
    expect(first.codeHash).toBe(createHash('sha256').update(config.code).digest('hex'));
    await createReport('same-config-report');
    const second = await deploy('same-config-report');
    expect(second.id).not.toBe(first.id);
    expect(second.config).toEqual(first.config);
    expect(await prisma.strategyDeployment.count({ where: { status: 'active' } })).toBe(2);
    expect(resources.factors).toHaveBeenLastCalledWith(config.code, 'owner', 'en', 'deployment');
    const listed = await (
      await request('/deployments?strategyId=strategy', undefined, 'owner', 'GET')
    ).json();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id }),
        expect.objectContaining({ id: second.id }),
      ]),
    );
    expect(
      await (await request('/deployments?strategyId=strategy', undefined, 'other', 'GET')).json(),
    ).toEqual([]);
    expect((await request(`/deployments/${first.id}/pause`, undefined, 'other')).status).toBe(404);
    expect((await request(`/deployments/${first.id}/pause`)).status).toBe(200);
    expect((await request(`/deployments/${first.id}/pause`)).status).toBe(200);
    expect(
      await prisma.strategyDeployment.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({ status: 'active' });
    const restarted = await deploy();
    expect(restarted.id).not.toBe(first.id);
    expect(
      await prisma.strategyDeployment.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ status: 'paused', activeReportId: null, backtestReportId: 'report' });
    expect(await (await request('/today', undefined, 'owner', 'GET')).json()).toHaveLength(3);
    expect(await enqueueSignalRun('owner', first.id, '20240103')).toEqual({ kind: 'paused' });
  });

  it('deduplicates concurrent deployment requests for one report with a database constraint', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => deploy()));
    expect(new Set(results.map((deployment) => deployment.id)).size).toBe(1);
    expect((await deploy()).id).toBe(results[0].id);
    expect(await prisma.strategyDeployment.count()).toBe(1);
    const row = await prisma.strategyDeployment.findFirstOrThrow();
    await expect(
      prisma.strategyDeployment.create({
        data: { ...row, id: 'duplicate', config, factorDependencies: dependencies },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('does not pause any deployment when creating another report deployment fails', async () => {
    const first = await deploy();
    await createReport('another-report');
    resources.id.mockReturnValueOnce(first.id);
    await expect(deploy('another-report')).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.strategyDeployment.count()).toBe(1);
    expect(
      await prisma.strategyDeployment.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ status: 'active', stoppedAt: null });
  });

  it('rejects missing or changed factor evidence rather than silently deploying current dependencies', async () => {
    resources.factors.mockResolvedValueOnce({
      modules: [],
      factors: [{ ...dependencies[0], codeHash: 'changed' }],
    });
    expect(await deployBacktestReport('owner', 'report', 'en')).toEqual({
      kind: 'dependencies_changed',
    });
    await prisma.backtestReport.update({ where: { id: 'report' }, data: { payload: {} } });
    expect(await deployBacktestReport('owner', 'report', 'en')).toEqual({
      kind: 'dependencies_changed',
    });
    expect(await prisma.strategyDeployment.count()).toBe(0);
    resources.factors.mockResolvedValue({ modules: [], factors: [] });
    expect((await deploy()).factorDependencies).toEqual([]);
  });

  it('preserves legacy deployments without guessing their report and protects deployed source history', async () => {
    const deployment = await deploy();
    await prisma.strategyDeployment.update({
      where: { id: deployment.id },
      data: { backtestReportId: null, activeReportId: null },
    });
    await expect(deleteStrategy('owner', 'strategy', 'en')).rejects.toMatchObject({
      category: 'invalid',
      message: t('en', 'strategyHasDeployments'),
    });
    await expect(deleteStrategy('other', 'strategy', 'en')).rejects.toMatchObject({
      category: 'missing',
    });
    const fresh = await deploy();
    expect(fresh.id).not.toBe(deployment.id);
    const listed = await (await request('/today', undefined, 'owner', 'GET')).json();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deployment: expect.objectContaining({
            id: deployment.id,
            backtestReportId: null,
            status: 'active',
          }),
        }),
      ]),
    );
    await expect(prisma.backtestReport.delete({ where: { id: 'report' } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.strategy.delete({ where: { id: 'strategy' } })).rejects.toMatchObject({
      code: 'P2003',
    });
    expect((await request(`/deployments/${deployment.id}/pause`)).status).toBe(200);
  });

  it('isolates same-date jobs and accounts for reports with identical configurations', async () => {
    const first = await deploy();
    await createReport('second-report');
    const second = await deploy('second-report');
    const firstRun = await enqueue(first.id);
    const secondRun = await enqueue(second.id);
    expect(firstRun.runId).not.toBe(secondRun.runId);
    expect(firstRun.jobId).not.toBe(secondRun.jobId);
    expect(await prisma.signalRun.count()).toBe(2);
    expect(
      await (await request(`/runs?deploymentId=${first.id}`, undefined, 'owner', 'GET')).json(),
    ).toEqual([expect.objectContaining({ id: firstRun.runId, deploymentId: first.id })]);
    expect(
      await (await request(`/runs?deploymentId=${second.id}`, undefined, 'owner', 'GET')).json(),
    ).toEqual([expect.objectContaining({ id: secondRun.runId, deploymentId: second.id })]);
    for (const run of [firstRun, secondRun]) {
      await prisma.signalRun.update({
        where: { id: run.runId },
        data: {
          status: 'done',
          modelCash: 100_000,
          modelEquity: 100_000,
          modelPositions: [],
          signals: [
            {
              code: '000001.SZ',
              name: 'Fixture',
              assetType: 'stock',
              action: 'buy',
              shares: 100,
              refPrice: 10,
              refAmount: 1000,
              source: 'order',
            },
          ],
        },
      });
      await initializeSignalAccounting(run.runId);
    }
    await settleStrategyAccounts('20240104', () => {});
    const otherBefore = await prisma.strategyAccountSnapshot.findMany({
      where: { deploymentId: second.id },
      orderBy: { id: 'asc' },
    });
    const execution = await prisma.signalExecution.findFirstOrThrow({
      where: { signalRunId: firstRun.runId },
    });
    expect(
      (
        await request(
          `/executions/${execution.id}`,
          { status: 'filled', shares: 100, price: 10.08, fee: 6 },
          'owner',
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      await prisma.strategyAccountSnapshot.findMany({
        where: { deploymentId: second.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(otherBefore);
    expect(
      await prisma.signalExecution.findFirstOrThrow({ where: { signalRunId: secondRun.runId } }),
    ).toMatchObject({ actualStatus: 'pending' });
    const restartedBefore = await request(`/deployments/${first.id}/pause`);
    expect(restartedBefore.status).toBe(200);
    const restarted = await deploy();
    expect(
      await prisma.strategyAccountSnapshot.count({ where: { deploymentId: restarted.id } }),
    ).toBe(0);
    expect(await prisma.strategyAccountSnapshot.count({ where: { deploymentId: first.id } })).toBe(
      4,
    );
  });

  it('does not enqueue a run if the deployment is paused during readiness checks', async () => {
    const deployment = await deploy();
    resources.yieldReady.mockImplementationOnce(async () => {
      await request(`/deployments/${deployment.id}/pause`);
      return true;
    });
    expect(await enqueueSignalRun('owner', deployment.id, '20240103')).toEqual({ kind: 'paused' });
    expect(await prisma.signalRun.count()).toBe(0);
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('rejects unavailable calendars and data before creating a run or waking the queue', async () => {
    const deployment = await deploy();
    expect(await enqueueSignalRun('other', deployment.id, '20240103')).toEqual({
      kind: 'not_found',
    });
    expect(await enqueueSignalRun('owner', deployment.id, '20240101')).toEqual({
      kind: 'invalid_date',
    });
    expect(await enqueueSignalRun('owner', deployment.id, '20240105')).toEqual({
      kind: 'next_date_missing',
    });
    resources.yieldReady.mockResolvedValueOnce(false);
    expect(await enqueueSignalRun('owner', deployment.id, '20240103')).toEqual({
      kind: 'data_not_ready',
    });
    await prisma.dailyBasic.deleteMany({ where: { tradeDate: '20240103' } });
    const response = await request('/run', { deploymentId: deployment.id, tradeDate: '20240103' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: t('en', 'signalDataNotReady', { date: '20240103' }) },
    });
    expect(await prisma.signalRun.count()).toBe(0);
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('deduplicates running and done requests while retrying errors on the frozen run', async () => {
    const deployment = await deploy();
    const first = await enqueue(deployment.id);
    expect(first.started).toBe(true);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: first.jobId! } })).toMatchObject({
      status: 'queued',
      kind: 'signal',
      signalRunId: first.runId,
      payload: { task: 'signal', runId: first.runId, locale: 'en' },
    });
    expect(await prisma.signalRun.findUniqueOrThrow({ where: { id: first.runId } })).toMatchObject({
      factorDependencies: dependencies,
      tradeDate: '20240103',
      execDate: '20240104',
    });
    expect(await enqueue(deployment.id)).toMatchObject({
      runId: first.runId,
      jobId: first.jobId,
      started: false,
    });
    await prisma.signalRun.update({ where: { id: first.runId }, data: { status: 'done' } });
    await prisma.job.update({ where: { id: first.jobId! }, data: { status: 'done' } });
    expect(await enqueue(deployment.id)).toMatchObject({
      runId: first.runId,
      jobId: first.jobId,
      started: false,
    });
    expect(resources.wake).toHaveBeenCalledTimes(1);
    await prisma.signalRun.update({
      where: { id: first.runId },
      data: {
        status: 'error',
        error: 'interrupted',
        dataCutoff: 'old',
        modelCash: 10,
        modelEquity: 20,
        modelPositions: [{ old: true }],
        signals: [{ old: true }],
        factorInputs: [{ old: true }],
        notifiedAt: new Date(),
        notificationError: 'delivery failed',
      },
    });
    await prisma.job.update({ where: { id: first.jobId! }, data: { status: 'error' } });
    await prisma.strategyDeployment.update({
      where: { id: deployment.id },
      data: { factorDependencies: [] },
    });
    const retry = await enqueue(deployment.id);
    expect(retry).toMatchObject({ runId: first.runId, started: true });
    expect(retry.jobId).not.toBe(first.jobId);
    expect(await prisma.signalRun.findUniqueOrThrow({ where: { id: first.runId } })).toMatchObject({
      status: 'running',
      factorDependencies: dependencies,
      error: null,
      dataCutoff: null,
      modelCash: null,
      modelEquity: null,
      modelPositions: [],
      signals: [],
      factorInputs: [],
      notifiedAt: null,
      notificationError: null,
    });
    expect(await prisma.job.count()).toBe(2);
    expect(resources.wake).toHaveBeenCalledTimes(2);
  });

  it('rolls back a newly created run when its Job cannot be persisted', async () => {
    const deployment = await deploy();
    await prisma.job.create({
      data: { id: 'occupied', userId: 'owner', kind: 'signal', key: 'fixture', status: 'done' },
    });
    resources.id.mockReturnValueOnce('new-run').mockReturnValueOnce('occupied');
    await expect(enqueueSignalRun('owner', deployment.id, '20240103')).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await prisma.signalRun.count()).toBe(0);
    expect(await prisma.job.count()).toBe(1);
    expect(resources.wake).not.toHaveBeenCalled();
    expect(resources.completion).not.toHaveBeenCalled();
  });

  it('resolves manual run dates at Shanghai close and keeps run/job reads owner scoped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-03T09:00:00Z'));
    const deployment = await deploy();
    vi.setSystemTime(new Date('2024-01-03T07:00:00Z'));
    expect(
      (await request('/run', { deploymentId: deployment.id, tradeDate: '20240103' })).status,
    ).toBe(400);
    vi.setSystemTime(new Date('2024-01-03T09:00:00Z'));
    const response = await request('/run', { deploymentId: deployment.id });
    expect(response.status).toBe(200);
    const run = await response.json();
    expect(Object.keys(run).sort()).toEqual(['jobId', 'runId', 'started']);
    expect(
      await (await request(`/runs/${run.runId}`, undefined, 'owner', 'GET')).json(),
    ).toMatchObject({
      id: run.runId,
      tradeDate: '20240103',
      execDate: '20240104',
      factorDependencies: dependencies,
    });
    for (const path of [
      `/runs/${run.runId}`,
      `/runs?deploymentId=${deployment.id}`,
      `/jobs/${run.jobId}`,
      `/deployments/${deployment.id}/execution-overview`,
    ]) {
      expect((await request(path, undefined, 'other', 'GET')).status).toBe(404);
    }
    expect(await (await request('/today', undefined, 'other', 'GET')).json()).toEqual([]);
    expect(await (await request('/today', undefined, 'owner', 'GET')).json()).toMatchObject([
      { deployment: { id: deployment.id }, run: { id: run.runId } },
    ]);
    expect(
      (await request('/run', { deploymentId: deployment.id, tradeDate: 'invalid' })).status,
    ).toBe(400);
  });

  it('keeps account initialization and settlement idempotent through actual-fill edits and reset', async () => {
    const deployment = await deploy();
    const run = await enqueue(deployment.id);
    await prisma.signalRun.update({
      where: { id: run.runId },
      data: {
        status: 'done',
        modelEquity: 100_000,
        modelCash: 100_000,
        modelPositions: [],
        signals: [
          {
            code: '000001.SZ',
            name: 'Fixture',
            assetType: 'stock',
            action: 'buy',
            shares: 100,
            refPrice: 10,
            refAmount: 1000,
            source: 'order',
          },
        ],
      },
    });
    await initializeSignalAccounting(run.runId);
    await initializeSignalAccounting(run.runId);
    expect(await prisma.signalExecution.count()).toBe(1);
    expect(await prisma.strategyAccountSnapshot.count()).toBe(2);
    const execution = await prisma.signalExecution.findFirstOrThrow({
      where: { signalRunId: run.runId },
    });
    const filled = { status: 'filled', shares: 100, price: 10.08, fee: 6 };
    expect((await request(`/executions/${execution.id}`, filled, 'owner', 'PATCH')).status).toBe(
      400,
    );
    await settleStrategyAccounts('20240104', () => {});
    await settleStrategyAccounts('20240104', () => {});
    expect(await prisma.strategyAccountSnapshot.count()).toBe(4);
    expect((await request(`/executions/${execution.id}`, filled, 'other', 'PATCH')).status).toBe(
      404,
    );
    expect(
      (await request(`/executions/${execution.id}`, { ...filled, shares: 101 }, 'owner', 'PATCH'))
        .status,
    ).toBe(400);
    const recorded = await request(`/executions/${execution.id}`, filled, 'owner', 'PATCH');
    expect(recorded.status).toBe(200);
    expect(await recorded.json()).toMatchObject({
      id: run.runId,
      executions: [{ actualStatus: 'filled', actualPrice: 10.08 }],
    });
    const overview = await (
      await request(`/deployments/${deployment.id}/execution-overview`, undefined, 'owner', 'GET')
    ).json();
    expect(overview.execution.averagePriceDeviationBps).toBeCloseTo(80, 8);
    expect(
      (await request(`/executions/${execution.id}`, { status: 'pending' }, 'owner', 'PATCH'))
        .status,
    ).toBe(200);
    expect(
      await prisma.signalExecution.findUniqueOrThrow({ where: { id: execution.id } }),
    ).toMatchObject({
      actualStatus: 'pending',
      actualShares: null,
      actualPrice: null,
      actualRecordedAt: null,
    });
    expect(
      await prisma.strategyAccountSnapshot.findUniqueOrThrow({
        where: {
          deploymentId_kind_tradeDate: {
            deploymentId: deployment.id,
            kind: 'actual',
            tradeDate: '20240104',
          },
        },
      }),
    ).toMatchObject({ cash: 100_000, equity: 100_000, positions: [] });
    expect(await prisma.strategyAccountSnapshot.count()).toBe(4);
  });
});
