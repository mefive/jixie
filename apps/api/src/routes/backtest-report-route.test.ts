import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  strategyFindFirst: vi.fn(),
  jobFindFirst: vi.fn(),
  backtestReportCreate: vi.fn(),
  transaction: vi.fn(),
  commitStrategyConfig: vi.fn(),
  extractFactorKeys: vi.fn(),
  initializeJobLogs: vi.fn(),
  wakeJobQueue: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock('../services/strategy-service.js', () => ({
  commitStrategyConfig: mocks.commitStrategyConfig,
}));
vi.mock('../engine/prepare-custom-factors.js', () => ({
  extractFactorKeys: mocks.extractFactorKeys,
}));
vi.mock('../lib/jobs.js', () => ({
  ACTIVE_JOB_STATUSES: ['queued', 'running'],
  findRunningJob: vi.fn(),
  getJob: vi.fn(),
  initializeJobLogs: mocks.initializeJobLogs,
}));
vi.mock('../lib/job-queue.js', () => ({
  wakeJobQueue: mocks.wakeJobQueue,
}));

import { backtestRoute } from './backtest.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', 'user-a');
  context.set('user', { id: 'user-a', email: 'owner@example.com', name: 'Owner' });
  await next();
});
app.route('/backtest', backtestRoute);

describe('backtest report route', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.strategyFindFirst.mockResolvedValue({ id: 'strategy-a' });
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.backtestReportCreate.mockResolvedValue({});
    mocks.commitStrategyConfig.mockResolvedValue({ name: '价值轮动' });
    mocks.extractFactorKeys.mockReturnValue([]);
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
    const response = await app.request('/backtest?strategyId=strategy-a', {
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
        status: 'running',
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
    expect(mocks.initializeJobLogs).toHaveBeenCalledWith(body.jobId);
    expect(mocks.wakeJobQueue).toHaveBeenCalledOnce();
  });
});
