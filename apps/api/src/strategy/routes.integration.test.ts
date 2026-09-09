import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { textMessage } from '@jixie/shared';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '', sequence: 0 }));
const resources = vi.hoisted(() => ({
  id: vi.fn(),
  enqueue: vi.fn(),
  running: vi.fn(),
  wake: vi.fn(),
  logs: vi.fn(),
  name: vi.fn(),
  parameters: vi.fn(),
}));
vi.mock('ulid', () => ({ ulid: resources.id }));
vi.mock('../infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-strategy-http-');
  const database = `${fixture.directory}/strategy.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});
vi.mock('../agent/turns/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/turns/run.js')>()),
  enqueueAgentTurn: resources.enqueue,
}));
vi.mock('../agent/turns/bus.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/turns/bus.js')>()),
  findRunning: resources.running,
}));
vi.mock('../infra/jobs/queue.js', () => ({ wakeJobQueue: resources.wake }));
vi.mock('../infra/jobs/logs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infra/jobs/logs.js')>()),
  initializeJobLogs: resources.logs,
}));
vi.mock('../infra/llm/deepseek.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infra/llm/deepseek.js')>()),
  chatText: resources.name,
}));
vi.mock('./runtime/typescript/walled-run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runtime/typescript/walled-run.js')>()),
  inspectWalledStrategyParameters: resources.parameters,
}));

import { prisma } from '../infra/database/prisma.js';
import { t } from '../i18n/index.js';
import { routes as strategyRoutes } from './routes.js';
import { routes as strategyDefinitionRoutes } from './definition-routes.js';
import { submitStrategyBacktest } from './backtest/submit.js';
import { submitStrategyScan } from './scans/submit.js';
import { publishedFactorContext } from './agent-context.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/strategies', strategyDefinitionRoutes);
app.route('/strategy', strategyRoutes);
const config = {
  name: 'Frozen strategy',
  start: '20240102',
  end: '20240105',
  initialCash: 100_000,
  code: 'export default defineStrategy({ name: "Frozen", params: { lookback: 20 } });',
};
function request(path: string, body?: unknown, userId = 'owner', method = 'POST') {
  return app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      'x-fixture-user': userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function seedJob(kind: string, status = 'queued') {
  return prisma.job.create({
    data: { id: 'existing-job', userId: 'owner', kind, key: 'strategy', status },
  });
}

describe('Strategy HTTP business boundaries', () => {
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
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/strategy.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    vi.clearAllMocks();
    resources.id.mockReset().mockImplementation(() => `generated-${++fixture.sequence}`);
    resources.running.mockReset().mockReturnValue(null);
    resources.name.mockReset().mockResolvedValue('Generated strategy');
    resources.parameters.mockReset().mockResolvedValue({ lookback: 20 });
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'strategy-owner@fixture.invalid' },
        { id: 'other', email: 'strategy-other@fixture.invalid' },
      ],
    });
    await prisma.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: config.name,
        config,
        lastResult: { marker: 'old result' },
        visibility: 'public',
      },
    });
    await prisma.tradeCal.createMany({
      data: ['20240102', '20240103', '20240104', '20240105'].map((calDate) => ({
        exchange: 'SSE',
        calDate,
        isOpen: 1,
      })),
    });
    await prisma.daily.create({ data: { tsCode: 'fixture', tradeDate: '20240104' } });
  });
  afterEach(async () => {
    await prisma.user.deleteMany();
    await prisma.factorComposite.deleteMany();
    await prisma.factor.deleteMany();
    await prisma.tradeCal.deleteMany();
    await prisma.daily.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('keeps owner-only editing and generated-name collision handling', async () => {
    expect((await request('/strategies/strategy', undefined, 'other', 'GET')).status).toBe(404);
    expect((await request('/strategies/strategy', { messages: [] }, 'other')).status).toBe(404);
    expect((await request('/strategies/strategy', undefined, 'other', 'DELETE')).status).toBe(404);
    resources.name.mockResolvedValue(config.name);
    const response = await request('/strategies', {
      ...config,
      prompt: 'Create a momentum strategy',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: `${config.name} 2` });
    expect(resources.name).toHaveBeenCalledTimes(1);
    expect((await request('/strategies/strategy', undefined, 'owner', 'DELETE')).status).toBe(200);
  });

  it('preserves result cache for renaming and messages but invalidates runnable inputs', async () => {
    expect(
      (await request('/strategies/strategy', { config: { ...config, name: 'Renamed' } })).status,
    ).toBe(200);
    expect(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
    ).toEqual({ marker: 'old result' });
    const messages = [textMessage('user', 'Discuss')];
    expect((await request('/strategies/strategy', { messages })).status).toBe(200);
    const updated = await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } });
    expect(updated.messages).toEqual(messages);
    expect(updated.lastResult).toEqual({ marker: 'old result' });
    expect(
      (await request('/strategies/strategy', { config: { ...config, initialCash: 200_000 } }))
        .status,
    ).toBe(200);
    expect(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).lastResult,
    ).toBeNull();
  });

  it('blocks config mutation during backtest while retaining message-only updates', async () => {
    await seedJob('backtest');
    const response = await request('/strategies/strategy', {
      config: { ...config, code: 'changed' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: t('en', 'strategyBacktestInProgress') },
    });
    expect((await request('/strategies/strategy', { messages: [] })).status).toBe(200);
    expect((await request('/strategy/backtest?strategyId=strategy', config)).status).toBe(400);
    expect((await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).config).toEqual(
      config,
    );
    expect(await prisma.backtestReport.count()).toBe(0);
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('freezes committed config and name in report/job and hides foreign reports', async () => {
    await prisma.strategy.create({
      data: { id: 'collision', userId: 'owner', name: 'Taken', config },
    });
    const candidate = { ...config, name: 'Taken', initialCash: 200_000 };
    const response = await request('/strategy/backtest?strategyId=strategy', candidate);
    expect(response.status).toBe(200);
    const { reportId, jobId } = await response.json();
    const frozenConfig = { ...candidate, name: config.name };
    const report = await prisma.backtestReport.findUniqueOrThrow({
      where: { id: reportId },
      include: { job: true },
    });
    expect(report).toMatchObject({
      config: frozenConfig,
      strategyName: config.name,
      status: 'running',
      job: { id: jobId, status: 'queued', payload: { config: frozenConfig, locale: 'en' } },
    });
    expect(resources.logs).toHaveBeenCalledWith(jobId);
    expect(resources.wake).toHaveBeenCalledTimes(1);
    await prisma.backtestReport.update({
      where: { id: reportId },
      data: { status: 'done', payload: { marker: 'frozen result' } },
    });
    await prisma.strategy.update({
      where: { id: 'strategy' },
      data: { config: { ...config, code: 'later code' }, lastResult: { marker: 'later result' } },
    });
    const detail = await request(
      `/strategy/backtest/reports/${reportId}`,
      undefined,
      'owner',
      'GET',
    );
    expect(await detail.json()).toMatchObject({
      config: frozenConfig,
      result: { marker: 'frozen result' },
    });
    expect(
      (await request(`/strategy/backtest/reports/${reportId}`, undefined, 'other', 'GET')).status,
    ).toBe(404);
    expect((await request(`/strategy/backtest/${jobId}`, undefined, 'other', 'GET')).status).toBe(
      404,
    );
  });

  it('rolls back config, report and job together if the nested job insert fails', async () => {
    await seedJob('backtest', 'done');
    resources.id.mockReturnValueOnce('new-report').mockReturnValueOnce('existing-job');
    await expect(
      submitStrategyBacktest(
        'owner',
        { ...config, code: 'changed' },
        { strategyId: 'strategy' },
        'en',
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.backtestReport.count()).toBe(0);
    expect(await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).toMatchObject({
      config,
      lastResult: { marker: 'old result' },
    });
    expect(resources.logs).not.toHaveBeenCalled();
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('freezes scan parameters, split ranges and data cutoff without changing the draft', async () => {
    const input = {
      config: { ...config, code: 'scan snapshot' },
      spec: { dimensions: [{ key: 'lookback', values: [10, 30] }], splitDate: '20240103' },
    };
    const response = await request('/strategy/scans?strategyId=strategy', input);
    expect(response.status).toBe(200);
    const { reportId, jobId } = await response.json();
    const report = await prisma.strategyScanReport.findUniqueOrThrow({
      where: { id: reportId },
      include: { job: true },
    });
    expect(report).toMatchObject({
      config: input.config,
      dataCutoff: '20240104',
      job: {
        id: jobId,
        status: 'queued',
        payload: {
          parameters: { lookback: 20 },
          ranges: {
            inSample: { start: '20240102', end: '20240103' },
            outOfSample: { start: '20240104', end: '20240105' },
          },
          locale: 'en',
        },
      },
    });
    expect((await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).config).toEqual(
      config,
    );
    expect((await request('/strategy/scans?strategyId=strategy', input)).status).toBe(400);
    expect((await request(`/strategy/scans/${reportId}`, undefined, 'other', 'GET')).status).toBe(
      404,
    );
    expect(
      (await request(`/strategy/scans/${reportId}/job`, undefined, 'other', 'GET')).status,
    ).toBe(404);
    expect(resources.wake).toHaveBeenCalledTimes(1);
  });

  it('rolls back scan reports on job failure and rejects Python scans before inspection', async () => {
    const input = { config, spec: { dimensions: [{ key: 'lookback', values: [10, 30] }] } };
    expect(
      (
        await request('/strategy/scans?strategyId=strategy', {
          ...input,
          config: { ...config, language: 'python' },
        })
      ).status,
    ).toBe(400);
    expect(resources.parameters).not.toHaveBeenCalled();
    await seedJob('strategy-scan', 'done');
    resources.id.mockReturnValueOnce('new-report').mockReturnValueOnce('existing-job');
    await expect(
      submitStrategyScan('owner', input, { strategyId: 'strategy' }, 'en'),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.strategyScanReport.count()).toBe(0);
    expect(resources.wake).not.toHaveBeenCalled();
    expect(resources.logs).not.toHaveBeenCalled();
  });

  it('makes factor-dependent drafts private and rejects republishing them', async () => {
    const dependent = {
      ...config,
      code: "export default defineStrategy({ factors: ['owner_factor'] });",
    };
    expect((await request('/strategy/backtest?strategyId=strategy', dependent)).status).toBe(200);
    expect(await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).toMatchObject({
      visibility: 'private',
    });
    const response = await request('/strategies/strategy/visibility', { visibility: 'public' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: t('en', 'publicStrategyMustBeSelfContained') },
    });
    expect(
      (await request('/strategies/strategy/visibility', { visibility: 'private' }, 'other')).status,
    ).toBe(404);
  });

  it('preserves naming validation and service-unavailable responses', async () => {
    expect((await request('/strategy/name', {})).status).toBe(400);
    expect(resources.name).not.toHaveBeenCalled();
    resources.name.mockRejectedValue(new Error('Naming fixture unavailable'));
    const response = await request('/strategy/name', { code: config.code });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Naming fixture unavailable' },
    });
  });

  it('checks Agent ownership and active turns and supplies only the owner’s published factors', async () => {
    const input = { id: 'strategy', code: config.code, message: 'Explain this strategy' };
    expect((await request('/strategy/agent', input, 'other')).status).toBe(404);
    resources.running.mockReturnValue('active-turn');
    expect((await request('/strategy/agent', input)).status).toBe(400);
    expect(resources.enqueue).not.toHaveBeenCalled();
    await prisma.factor.createMany({
      data: [
        {
          id: 'published',
          key: 'owner_factor',
          code: 'fixture',
          name: 'Owned',
          userId: 'owner',
          status: 'published',
        },
        {
          id: 'draft',
          key: 'draft_factor',
          code: 'fixture',
          name: 'Draft',
          userId: 'owner',
          status: 'draft',
        },
        {
          id: 'foreign',
          key: 'foreign_factor',
          code: 'fixture',
          name: 'Foreign',
          userId: 'other',
          status: 'published',
          visibility: 'public',
        },
      ],
    });
    const context = await publishedFactorContext('owner');
    expect(context).toContain('owner_factor');
    expect(context).not.toContain('draft_factor');
    expect(context).not.toContain('foreign_factor');
    resources.running.mockReturnValue(null);
    expect((await request('/strategy/agent', input)).status).toBe(200);
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        entity: { kind: 'strategy', id: 'strategy' },
        currentCode: config.code,
        locale: 'en',
      }),
    );
  });
});
