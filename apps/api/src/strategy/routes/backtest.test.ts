import { handleApiError } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  strategyFindFirst: vi.fn(),
  jobFindFirst: vi.fn(),
  backtestReportCreate: vi.fn(),
  backtestReportFindMany: vi.fn(),
  backtestReportFindFirst: vi.fn(),
  transaction: vi.fn(),
  commitStrategyConfig: vi.fn(),
  extractFactorKeys: vi.fn(),
  initializeLogs: vi.fn(),
  wake: vi.fn(),
  refreshStrategyName: vi.fn(),
}));

vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    backtestReport: {
      findMany: mocks.backtestReportFindMany,
      findFirst: mocks.backtestReportFindFirst,
    },
  },
}));
vi.mock('../definitions/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../definitions/config.js')>()),
  commitStrategyConfig: mocks.commitStrategyConfig,
}));
vi.mock('../definitions/naming.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../definitions/naming.js')>()),
  refreshStrategyName: mocks.refreshStrategyName,
}));
vi.mock('../factor-inputs/references.js', () => ({
  extractFactorKeys: mocks.extractFactorKeys,
}));
vi.mock('#jobs/service.js', () => ({
  ACTIVE_JOB_STATUSES: ['queued', 'running'],
  JobService: { get: vi.fn() },
}));
vi.mock('#jobs/logs.js', () => ({ JobLogs: { initialize: mocks.initializeLogs } }));
vi.mock('#jobs/scheduler.js', () => ({
  JobScheduler: { wake: mocks.wake },
}));

import { strategyRunKey } from '../definitions/config.js';
import { strategyRoute } from './index.js';

const app = new Hono().onError(handleApiError);
app.use('*', async (context, next) => {
  context.set('userId', 'user-a');
  context.set('user', { id: 'user-a', email: 'owner@example.com', name: 'Owner' });
  await next();
});
app.route('/strategies', strategyRoute);

describe('backtest report route', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.strategyFindFirst.mockResolvedValue({ id: 'strategy-a' });
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.backtestReportCreate.mockResolvedValue({});
    mocks.commitStrategyConfig.mockResolvedValue({ name: '价值轮动' });
    mocks.extractFactorKeys.mockReturnValue([]);
    mocks.refreshStrategyName.mockResolvedValue(false);
    mocks.transaction.mockImplementation((callback) =>
      callback({
        strategy: { findFirst: mocks.strategyFindFirst },
        job: { findFirst: mocks.jobFindFirst },
        backtestReport: { create: mocks.backtestReportCreate },
      }),
    );
  });

  it('creates one immutable report linked to the queued backtest job', async () => {
    const config = {
      name: '提交前名称',
      start: '20200101',
      end: '20251231',
      initialCash: 1_000_000,
      language: 'typescript',
      runtimeVersion: 'ts-v1',
      code: 'export default defineStrategy({ onBar() {} });',
    };
    const response = await app.request('/strategies/strategy-a/backtests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'zh-CN' },
      body: JSON.stringify(config),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ jobId: expect.any(String), reportId: expect.any(String) });
    expect(mocks.backtestReportCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: body.reportId,
        userId: 'user-a',
        strategyId: 'strategy-a',
        strategyName: '价值轮动',
        legacyStatus: null,
        config: expect.objectContaining({ name: '价值轮动', code: config.code }),
        codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        job: {
          create: expect.objectContaining({
            id: body.jobId,
            status: 'queued',
            payload: expect.objectContaining({
              task: 'backtest',
              reportId: body.reportId,
              strategyId: 'strategy-a',
              userId: 'user-a',
            }),
          }),
        },
      }),
    });
    expect(mocks.initializeLogs).not.toHaveBeenCalled();
    expect(mocks.wake).toHaveBeenCalledOnce();
    expect(mocks.refreshStrategyName).toHaveBeenCalledExactlyOnceWith({
      id: 'strategy-a',
      userId: 'user-a',
      code: config.code,
      currentName: '价值轮动',
      expectedRunKey: strategyRunKey(config),
      locale: 'zh',
    });
  });

  it('starts naming only after commit and returns while naming is pending', async () => {
    let finishCommit!: () => void;
    let finishRename!: (value: boolean) => void;
    const naming = new Promise<boolean>((resolve) => {
      finishRename = resolve;
    });
    mocks.refreshStrategyName.mockReturnValueOnce(naming);
    const transaction = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementationOnce(async (callback) => {
      const result = await transaction(callback);
      await new Promise<void>((resolve) => {
        finishCommit = resolve;
      });
      return result;
    });
    const response = submitBacktest();

    try {
      await vi.waitFor(() => expect(finishCommit).toBeTypeOf('function'));
      expect(mocks.refreshStrategyName).not.toHaveBeenCalled();
      expect(mocks.wake).not.toHaveBeenCalled();
      finishCommit();
      expect((await response).status).toBe(200);
      expect(mocks.refreshStrategyName).toHaveBeenCalledOnce();
      expect(mocks.wake).toHaveBeenCalledOnce();
    } finally {
      finishCommit?.();
      finishRename(false);
      await response;
      await naming;
    }
  });

  it('logs naming failure without failing the accepted submission', async () => {
    const failure = new Error('naming unavailable');
    mocks.refreshStrategyName.mockRejectedValueOnce(failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await submitBacktest()).status).toBe(200);
      expect(mocks.wake).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('[jixie] strategy rename failed', failure);
    } finally {
      log.mockRestore();
    }
  });

  it.each(['missing', 'running', 'invalid', 'rollback'] as const)(
    'does not trigger naming when submission is rejected: %s',
    async (reason) => {
      switch (reason) {
        case 'missing':
          mocks.strategyFindFirst.mockResolvedValueOnce(null);
          break;
        case 'running':
          mocks.jobFindFirst.mockResolvedValueOnce({ id: 'existing-job' });
          break;
        case 'rollback':
          mocks.transaction.mockRejectedValueOnce(new Error('commit failed'));
          break;
        case 'invalid':
          break;
      }
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await submitBacktest(reason === 'invalid' ? { end: '20190101' } : {});
        expect(response.status).toBe(
          { missing: 404, running: 409, invalid: 400, rollback: 500 }[reason],
        );
        expect(mocks.refreshStrategyName).not.toHaveBeenCalled();
        expect(mocks.wake).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );

  it('lists compact completed report history within the strategy owner scope', async () => {
    mocks.backtestReportFindMany.mockResolvedValue([reportRow()]);

    const response = await app.request('/strategies/strategy-a/backtest-reports');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.backtestReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a', strategyId: 'strategy-a' }),
      }),
    );
    expect(body).toEqual([
      expect.objectContaining({
        id: 'report-a',
        language: 'python',
        totalReturn: 0.2,
        sharpe: 1.1,
      }),
    ]);
  });

  it('loads one full immutable report without using Strategy.lastResult', async () => {
    mocks.backtestReportFindFirst.mockResolvedValue({
      ...reportRow(),
      codeHash: 'code-hash',
      resultHash: 'result-hash',
    });

    const response = await app.request('/strategies/backtest-reports/report-a');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.backtestReportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'report-a', userId: 'user-a' }),
      }),
    );
    expect(body).toMatchObject({
      id: 'report-a',
      config: { start: '20200101', end: '20251231' },
      result: { totalReturn: 0.2, sharpe: 1.1 },
      codeHash: 'code-hash',
      resultHash: 'result-hash',
    });
  });
});

function reportRow() {
  return {
    id: 'report-a',
    strategyId: 'strategy-a',
    strategyName: '价值轮动',
    config: {
      name: '价值轮动',
      start: '20200101',
      end: '20251231',
      initialCash: 1_000_000,
      language: 'python',
      runtimeVersion: 'py-v1',
      code: 'def strategy(context):\n    pass',
    },
    payload: {
      name: '价值轮动',
      start: '20200101',
      end: '20251231',
      days: 100,
      initialCash: 1_000_000,
      finalValue: 1_200_000,
      totalReturn: 0.2,
      annReturn: 0.1,
      sharpe: 1.1,
      maxDrawdown: -0.08,
      trades: 4,
      tradeLog: [],
      nav: [],
    },
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    computedAt: new Date('2026-09-01T08:05:00.000Z'),
  };
}

function submitBacktest(overrides: Record<string, unknown> = {}) {
  return app.request('/strategies/strategy-a/backtests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': 'en' },
    body: JSON.stringify({ ...reportRow().config, ...overrides }),
  });
}
