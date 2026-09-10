import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { Prisma } from '@prisma/client';
import type { FactorPanelCompositeDefinitionV2 } from '@jixie/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '', sequence: 0 }));
const resources = vi.hoisted(() => ({
  id: vi.fn(),
  enqueue: vi.fn(),
  running: vi.fn(),
  wake: vi.fn(),
  logs: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('ulid', () => ({ ulid: resources.id }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-factor-http-');
  const database = `${fixture.directory}/factor.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});
vi.mock('#agent/turns/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#agent/turns/run.js')>()),
  enqueueAgentTurn: resources.enqueue,
}));
vi.mock('#agent/turns/bus.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#agent/turns/bus.js')>()),
  findRunning: resources.running,
}));
vi.mock('#infra/jobs/queue.js', () => ({ wakeJobQueue: resources.wake }));
vi.mock('#infra/jobs/logs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#infra/jobs/logs.js')>()),
  initializeJobLogs: resources.logs,
}));
vi.mock('./weather/refresh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./weather/refresh.js')>()),
  refreshFactorWeatherPin: resources.refresh,
}));

import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import { copyFactorComposite } from './composition/operations.js';
import { submitFactorHoldout } from './reports/holdout.js';
import { sha256 } from './reports/spec.js';
import { factorsRoute, factorRoute, factorWeatherRoute } from './routes.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/factors', factorsRoute);
app.route('/factor', factorRoute);
app.route('/factor-weather', factorWeatherRoute);
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
const intent = {
  version: 1,
  mode: 'hypothesis',
  hypothesis: 'The frozen signal predicts returns.',
  expectedDirection: 'positive',
  primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0 },
} as const;
const frozenCode = 'export default defineFactor({ name: "Frozen", compute: () => 1 });';
async function seedReport(phase = 'explore') {
  return prisma.factorReport.create({
    data: {
      id: 'report',
      userId: 'owner',
      factor: 'draft',
      phase,
      status: 'done',
      freq: 'month',
      start: '20200101',
      end: '20231229',
      factorCodeSnapshot: frozenCode,
      factorCodeHash: sha256(frozenCode),
      dataRevision: 'fixture-vintage',
      researchIntentJson: JSON.stringify(intent),
      testKey: 'frozen-test',
      payload: JSON.stringify({ label: 'Frozen', icMean: 0.125 }),
    },
  });
}
async function seedPin(status = 'ready') {
  return prisma.factorWeatherPin.create({
    data: {
      id: 'pin',
      userId: 'owner',
      factorId: 'draft',
      factorName: 'Draft',
      builtin: false,
      direction: 'positive',
      factorCode: frozenCode,
      factorCodeHash: sha256(frozenCode),
      methodologyHash: 'fixture',
      status,
    },
  });
}
async function seedPublicComposite() {
  await prisma.factor.createMany({
    data: ['component_a', 'component_b'].map((id) => ({
      id,
      key: id,
      name: id,
      userId: 'other',
      analysisKind: 'panel',
      status: 'published',
      language: 'python',
      runtimeVersion: 'py-v1',
      code: `# ${id} frozen`,
      messages: [{ role: 'user', content: 'Private discussion' }],
    })),
  });
  const definition: FactorPanelCompositeDefinitionV2 = {
    version: 2,
    key: 'public_panel',
    name: 'Public panel',
    analysisKind: 'panel',
    standardization: 'rank',
    weighting: 'equal',
    components: [
      { factor: 'component_a', direction: 'positive' },
      { factor: 'component_b', direction: 'negative' },
    ],
  };
  await prisma.factorComposite.create({
    data: {
      id: 'composite',
      key: definition.key,
      name: definition.name,
      userId: 'other',
      definition: definition as unknown as Prisma.InputJsonValue,
      status: 'published',
      visibility: 'public',
    },
  });
}

describe('Factor HTTP business boundaries', () => {
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
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/factor.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    vi.clearAllMocks();
    resources.id.mockReset().mockImplementation(() => `generated-${++fixture.sequence}`);
    resources.running.mockReset().mockReturnValue(null);
    resources.refresh.mockReset().mockResolvedValue(undefined);
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid' },
        { id: 'other', email: 'other@fixture.invalid' },
      ],
    });
    await prisma.factor.create({
      data: {
        id: 'draft',
        key: 'draft_factor',
        name: 'Draft',
        code: frozenCode,
        userId: 'owner',
      },
    });
    await prisma.daily.createMany({
      data: ['20231229', '20240102', '20250630'].map((tradeDate) => ({
        tsCode: 'fixture',
        tradeDate,
      })),
    });
  });
  afterEach(async () => {
    await prisma.user.deleteMany();
    await prisma.factorComposite.deleteMany();
    await prisma.factor.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.daily.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('protects pinned and published definitions and retains history after draft deletion', async () => {
    await seedReport();
    await seedPin();
    const pinned = await request('/factors/custom/draft', { code: 'changed code' });
    expect(pinned.status).toBe(400);
    expect(await pinned.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: t('en', 'pinnedFactorReadonlyEdit') },
    });
    expect((await request('/factors/custom/draft', undefined, 'other', 'DELETE')).status).toBe(404);
    await prisma.factorWeatherPin.deleteMany();
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect((await request('/factors/custom/draft', { name: 'Changed' })).status).toBe(400);
    expect((await request('/factors/custom/draft', undefined, 'owner', 'DELETE')).status).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    expect((await request('/factors/custom/draft', undefined, 'owner', 'DELETE')).status).toBe(200);
    expect(await prisma.factorReport.findUnique({ where: { id: 'report' } })).not.toBeNull();
  });

  it('allows public published copies without exposing private authoring context', async () => {
    await prisma.factor.update({
      where: { id: 'draft' },
      data: {
        visibility: 'public',
        status: 'published',
        messages: [{ role: 'user', content: 'Private' }],
        researchHandoff: { private: true },
        language: 'python',
        runtimeVersion: 'py-v1',
      },
    });
    const read = await request('/factors/custom/draft', undefined, 'other', 'GET');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      messages: null,
      researchHandoff: null,
      sourceResearchExecution: null,
    });
    const copied = await request('/factors/custom/draft/copy', undefined, 'other');
    expect(copied.status).toBe(200);
    const { id } = await copied.json();
    expect(await prisma.factor.findUnique({ where: { id } })).toMatchObject({
      userId: 'other',
      status: 'draft',
      visibility: 'private',
      code: frozenCode,
      language: 'python',
      runtimeVersion: 'py-v1',
      messages: null,
      researchHandoff: null,
    });
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'archived' } });
    expect((await request('/factors/custom/draft/copy', undefined, 'other')).status).toBe(404);
  });

  it('copies public panel components into independent drafts with their original runtime', async () => {
    await seedPublicComposite();
    const response = await request('/factors/composites/composite/copy');
    expect(response.status).toBe(200);
    const copy = await response.json();
    expect(copy).toMatchObject({ status: 'draft', visibility: 'private' });
    const definition = copy.definition as FactorPanelCompositeDefinitionV2;
    expect(definition.components.map((component) => component.factor)).not.toEqual([
      'component_a',
      'component_b',
    ]);
    const components = await prisma.factor.findMany({
      where: { id: { in: definition.components.map((component) => component.factor) } },
      orderBy: { key: 'asc' },
    });
    expect(components).toHaveLength(2);
    for (const component of components) {
      expect(component).toMatchObject({
        userId: 'owner',
        status: 'draft',
        language: 'python',
        runtimeVersion: 'py-v1',
        messages: null,
      });
    }
    expect(components.map((component) => component.code)).toEqual([
      '# component_a frozen',
      '# component_b frozen',
    ]);
  });

  it('rolls back copied components if the final composite insert fails', async () => {
    await seedPublicComposite();
    resources.id
      .mockReturnValueOnce('new-a')
      .mockReturnValueOnce('new-b')
      .mockReturnValueOnce('composite');
    await expect(copyFactorComposite('owner', 'composite', 'en')).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await prisma.factor.count({ where: { userId: 'owner' } })).toBe(1);
    expect(await prisma.factorComposite.count({ where: { userId: 'owner' } })).toBe(0);
  });

  it('keeps holdout metrics, payload and job logs sealed until owner reveal', async () => {
    await seedReport('holdout');
    const logs = [{ at: '2025-06-30T00:00:00Z', message: 'Secret metric: 0.125' }];
    await prisma.job.create({
      data: {
        id: 'job',
        userId: 'owner',
        kind: 'factor',
        key: 'fixture',
        status: 'done',
        factorReportId: 'report',
        logs: JSON.stringify(logs),
      },
    });
    const list = await (
      await request('/factor/reports?factor=draft', undefined, 'owner', 'GET')
    ).json();
    expect(list.items[0]).toMatchObject({ sealed: true });
    expect(list.items[0]).not.toHaveProperty('metrics');
    const detail = await (
      await request('/factor/reports/report', undefined, 'owner', 'GET')
    ).json();
    expect(detail).toMatchObject({ sealed: true, canReveal: true });
    expect(detail).not.toHaveProperty('payload');
    expect(detail).not.toHaveProperty('researchPayload');
    expect(
      await (await request('/factor/analysis/job/job', undefined, 'owner', 'GET')).json(),
    ).toMatchObject({ logs: [] });
    expect((await request('/factor/reports/report', undefined, 'other', 'GET')).status).toBe(404);
    expect((await request('/factor/analysis/job/job', undefined, 'other', 'GET')).status).toBe(404);
    expect((await request('/factor/reports/report/reveal', undefined, 'other')).status).toBe(400);
    const revealed = await (await request('/factor/reports/report/reveal')).json();
    expect(revealed).toMatchObject({
      sealed: false,
      canReveal: false,
      metrics: { rankIc: 0.125 },
      payload: { icMean: 0.125 },
    });
    const second = await (await request('/factor/reports/report/reveal')).json();
    expect(second.revealedAt).toBe(revealed.revealedAt);
    expect(
      await (await request('/factor/analysis/job/job', undefined, 'owner', 'GET')).json(),
    ).toMatchObject({ logs });
  });

  it('submits a frozen holdout snapshot and reuses its job without waking twice', async () => {
    const parent = await seedReport();
    await prisma.factor.update({
      where: { id: 'draft' },
      data: { code: 'different current code' },
    });
    expect((await request('/factor/reports/report/holdout', undefined, 'other')).status).toBe(404);
    const response = await request('/factor/reports/report/holdout');
    expect(response.status).toBe(200);
    const result = await response.json();
    const report = await prisma.factorReport.findUniqueOrThrow({
      where: { id: result.reportId },
      include: { job: true },
    });
    expect(report).toMatchObject({
      phase: 'holdout',
      start: '20240102',
      end: '20250630',
      factorCodeSnapshot: frozenCode,
      factorCodeHash: parent.factorCodeHash,
      parentReportId: parent.id,
      dataRevision: parent.dataRevision,
      testKey: parent.testKey,
      job: { id: result.jobId, status: 'queued' },
    });
    expect(report.job?.payload).toMatchObject({ source: { code: frozenCode }, locale: 'en' });
    expect(await (await request('/factor/reports/report/holdout')).json()).toMatchObject({
      reportId: result.reportId,
      jobId: result.jobId,
      reusedRunning: true,
    });
    expect(resources.wake).toHaveBeenCalledTimes(1);
    expect(resources.logs).toHaveBeenCalledWith(result.jobId);
  });

  it('rolls back holdout report creation when its job cannot be inserted', async () => {
    await seedReport();
    await prisma.job.create({
      data: { id: 'existing-job', userId: 'owner', kind: 'factor', key: 'fixture', status: 'done' },
    });
    resources.id.mockReturnValueOnce('new-report').mockReturnValueOnce('existing-job');
    await expect(submitFactorHoldout('owner', 'report', 'en')).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await prisma.factorReport.count({ where: { phase: 'holdout' } })).toBe(0);
    expect(resources.logs).not.toHaveBeenCalled();
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('checks Agent input, ownership, publication and active turns before enqueue', async () => {
    const input = { id: 'draft', code: frozenCode, message: 'Explain this factor' };
    expect((await request('/factor/agent', { ...input, message: '' })).status).toBe(400);
    expect((await request('/factor/agent', input, 'other')).status).toBe(404);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect((await request('/factor/agent', input)).status).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    resources.running.mockReturnValue('active-turn');
    expect((await request('/factor/agent', input)).status).toBe(400);
    expect(resources.enqueue).not.toHaveBeenCalled();
    resources.running.mockReturnValue(null);
    expect((await request('/factor/agent', input)).status).toBe(200);
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        entity: { kind: 'factor', id: 'draft' },
        currentCode: frozenCode,
        locale: 'en',
        afterTurn: expect.any(Function),
      }),
    );
  });

  it('keeps weather ownership, frozen snapshots, detached refresh and busy errors', async () => {
    expect(
      (await request('/factor-weather/pins', { factorId: 'draft', direction: 'positive' })).status,
    ).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect(
      (await request('/factor-weather/pins', { factorId: 'draft', direction: 'positive' }, 'other'))
        .status,
    ).toBe(404);
    const response = await request('/factor-weather/pins', {
      factorId: 'draft',
      direction: 'positive',
    });
    expect(response.status).toBe(200);
    const pin = await response.json();
    expect(await prisma.factorWeatherPin.findUnique({ where: { id: pin.id } })).toMatchObject({
      factorCode: frozenCode,
      direction: 'positive',
      status: 'pending',
    });
    expect(resources.refresh).toHaveBeenCalledWith(pin.id);
    const busy = await request(`/factor-weather/pins/${pin.id}`, undefined, 'owner', 'DELETE');
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: { code: 'CONFLICT', message: t('en', 'factorWeatherRunningCannotUnpin') },
    });
    expect(
      (await request(`/factor-weather/pins/${pin.id}/refresh`, undefined, 'other')).status,
    ).toBe(404);
    await request('/factor-weather', undefined, 'owner', 'GET');
    expect(resources.refresh).toHaveBeenCalledTimes(2);
    await prisma.factorWeatherPin.update({ where: { id: pin.id }, data: { status: 'ready' } });
    expect(
      (await request(`/factor-weather/pins/${pin.id}`, undefined, 'owner', 'DELETE')).status,
    ).toBe(200);
  });
});
