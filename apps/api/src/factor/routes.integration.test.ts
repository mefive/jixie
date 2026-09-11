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
import { factorRoute } from './routes.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/factors', factorRoute);
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
    await prisma.factorCorrelation.deleteMany();
    await prisma.daily.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('protects pinned and published definitions and retains history after draft deletion', async () => {
    await seedReport();
    await seedPin();
    const pinned = await request('/factors/draft', { code: 'changed code' }, 'owner', 'PATCH');
    expect(pinned.status).toBe(400);
    expect(await pinned.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: t('en', 'pinnedFactorReadonlyEdit') },
    });
    expect((await request('/factors/draft', undefined, 'other', 'DELETE')).status).toBe(404);
    await prisma.factorWeatherPin.deleteMany();
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect((await request('/factors/draft', { name: 'Changed' }, 'owner', 'PATCH')).status).toBe(
      400,
    );
    expect((await request('/factors/draft', undefined, 'owner', 'DELETE')).status).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    expect((await request('/factors/draft', undefined, 'owner', 'DELETE')).status).toBe(200);
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
    const read = await request('/factors/draft', undefined, 'other', 'GET');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      messages: null,
      researchHandoff: null,
      sourceResearchExecution: null,
    });
    const copied = await request('/factors/draft/copy', undefined, 'other');
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
    expect((await request('/factors/draft/copy', undefined, 'other')).status).toBe(404);
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
      await request('/factors/analysis-reports?factor=draft', undefined, 'owner', 'GET')
    ).json();
    expect(list.items[0]).toMatchObject({ sealed: true });
    expect(list.items[0]).not.toHaveProperty('metrics');
    const detail = await (
      await request('/factors/analysis-reports/report', undefined, 'owner', 'GET')
    ).json();
    expect(detail).toMatchObject({ sealed: true, canReveal: true });
    expect(detail).not.toHaveProperty('payload');
    expect(detail).not.toHaveProperty('researchPayload');
    expect(
      await (await request('/factors/analysis-jobs/job', undefined, 'owner', 'GET')).json(),
    ).toMatchObject({ logs: [] });
    expect((await request('/factors/correlation-jobs/job', undefined, 'owner', 'GET')).status).toBe(
      404,
    );
    expect(
      (await request('/factors/analysis-reports/report', undefined, 'other', 'GET')).status,
    ).toBe(404);
    expect((await request('/factors/analysis-jobs/job', undefined, 'other', 'GET')).status).toBe(
      404,
    );
    expect(
      (await request('/factors/analysis-reports/report/reveal', undefined, 'other')).status,
    ).toBe(400);
    const revealed = await (await request('/factors/analysis-reports/report/reveal')).json();
    expect(revealed).toMatchObject({
      sealed: false,
      canReveal: false,
      metrics: { rankIc: 0.125 },
      payload: { icMean: 0.125 },
    });
    const second = await (await request('/factors/analysis-reports/report/reveal')).json();
    expect(second.revealedAt).toBe(revealed.revealedAt);
    expect(
      await (await request('/factors/analysis-jobs/job', undefined, 'owner', 'GET')).json(),
    ).toMatchObject({ logs });
  });

  it('submits a frozen holdout snapshot and reuses its job without waking twice', async () => {
    const parent = await seedReport();
    await prisma.factor.update({
      where: { id: 'draft' },
      data: { code: 'different current code' },
    });
    expect(
      (await request('/factors/analysis-reports/report/holdout', undefined, 'other')).status,
    ).toBe(404);
    const response = await request('/factors/analysis-reports/report/holdout');
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
    expect(await (await request('/factors/analysis-reports/report/holdout')).json()).toMatchObject({
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

  it('reserves collection paths and requires PATCH for factor and composite edits', async () => {
    expect((await request('/factors', undefined, 'owner', 'GET')).status).toBe(200);
    expect((await request('/factors/catalog', undefined, 'owner', 'GET')).status).toBe(200);
    expect((await request('/factors/analysis-reports', undefined, 'owner', 'GET')).status).toBe(
      400,
    );
    expect((await request('/factors/correlations', undefined, 'owner', 'GET')).status).toBe(400);
    expect((await request('/factors/correlations')).status).toBe(400);
    expect((await request('/factors/analyses', {})).status).toBe(400);
    expect((await request('/factors/draft', { name: 'Old method' })).status).toBe(404);
    expect((await request('/factors/composites/missing', { definition: {} })).status).toBe(404);
    expect(
      (await request('/factors/draft/visibility', { visibility: 'private' }, 'owner', 'PATCH'))
        .status,
    ).toBe(200);
    expect((await request('/factors/custom/draft', undefined, 'owner', 'GET')).status).toBe(404);
  });

  it.each(['/missing/publish', '/composites/missing/publish'])(
    'preserves publication error mapping for %s',
    async (path) => {
      const response = await request(`/factors${path}`, { approvedReportId: 'report' });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    },
  );

  it.each([null, {}, { task: 'analysis' }])(
    'reads owned analysis jobs with current and historical payloads: %j',
    async (payload) => {
      await seedReport();
      const logs = [{ source: 'system', level: 'info', text: 'Analysis complete' }];
      await prisma.job.create({
        data: {
          id: 'analysis-job',
          userId: 'owner',
          kind: 'factor',
          key: 'analysis',
          status: 'done',
          factorReportId: 'report',
          logs: JSON.stringify(logs),
          ...(payload === null ? {} : { payload }),
        },
      });
      const response = await request(
        '/factors/analysis-jobs/analysis-job',
        undefined,
        'owner',
        'GET',
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ logs, nextSince: 1, factorReportId: 'report' });
      expect(
        (await request('/factors/correlation-jobs/analysis-job', undefined, 'owner', 'GET')).status,
      ).toBe(404);
    },
  );

  it('rejects foreign report relations and prevents correlation polling from bypassing holdout sealing', async () => {
    await seedReport('holdout');
    await prisma.job.create({
      data: {
        id: 'job',
        userId: 'other',
        kind: 'factor',
        key: 'fixture',
        status: 'done',
        factorReportId: 'report',
        payload: { task: 'analysis' },
      },
    });
    expect((await request('/factors/analysis-jobs/job', undefined, 'other', 'GET')).status).toBe(
      404,
    );
    await prisma.job.update({
      where: { id: 'job' },
      data: { userId: 'owner', payload: { task: 'correlation' } },
    });
    for (const resource of ['analysis-jobs', 'correlation-jobs']) {
      expect((await request(`/factors/${resource}/job`, undefined, 'owner', 'GET')).status).toBe(
        404,
      );
    }
  });

  describe('correlation resources', () => {
    const input = { keys: ['ep', 'bp'], freq: 'month', start: '20200101', end: '20231229' };
    const query = 'keys=ep,bp&freq=month&start=20200101&end=20231229';
    const cacheId = 'owner|bp,ep|month|20200101|20231229';

    async function submit() {
      const response = await request('/factors/correlations', input);
      expect(response.status).toBe(200);
      return (await response.json()) as { jobId: string };
    }

    it('uses JSON inputs, normalizes keys and defaults, and ignores query overrides', async () => {
      const response = await request('/factors/correlations?keys=foreign&freq=week', {
        keys: [' ep ', 'bp', 'ep'],
      });
      expect(response.status).toBe(200);
      const { jobId } = await response.json();
      expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
        userId: 'owner',
        kind: 'factor',
        key: 'corr|bp,ep|month|20150101|20261231',
        payload: {
          task: 'correlation',
          keys: ['ep', 'bp'],
          freq: 'month',
          start: '20150101',
          end: '20261231',
        },
      });
      expect(resources.wake).toHaveBeenCalledOnce();
      expect(resources.logs).toHaveBeenCalledWith(jobId);
    });

    it.each([
      { keys: 'ep,bp' },
      { keys: [] },
      { keys: ['ep', 'ep'] },
      { ...input, refresh: '1' },
      { ...input, start: '20231230' },
      { keys: ['foreign', 'ep'] },
    ])('rejects invalid submission without enqueueing: %j', async (body) => {
      expect((await request('/factors/correlations', body)).status).toBe(400);
      expect(await prisma.job.count()).toBe(0);
      expect(resources.wake).not.toHaveBeenCalled();
    });

    it('preserves cached results, forced refresh, sorted cache keys and active-job reuse', async () => {
      const report = { marker: 'cached result' };
      await prisma.factorCorrelation.create({
        data: {
          id: cacheId,
          userId: 'owner',
          payload: JSON.stringify(report),
          computedAt: new Date(),
        },
      });
      const cached = await request('/factors/correlations', { ...input, keys: ['bp', 'ep'] });
      expect(await cached.json()).toEqual({ done: true, report });
      expect(resources.wake).not.toHaveBeenCalled();
      expect(
        await (await request(`/factors/correlations?${query}`, undefined, 'owner', 'GET')).json(),
      ).toEqual(report);
      expect(
        (await request(`/factors/correlations?${query}`, undefined, 'other', 'GET')).status,
      ).toBe(404);
      const forced = await request('/factors/correlations', { ...input, refresh: true });
      const reference = await forced.json();
      expect(reference).toEqual({ jobId: expect.any(String) });
      expect(
        await (await request('/factors/correlations', { ...input, refresh: true })).json(),
      ).toEqual(reference);
      expect(await prisma.job.count()).toBe(1);
      expect(resources.wake).toHaveBeenCalledOnce();
    });

    it.each(['queued', 'running', 'done', 'error', 'stale'])(
      'returns an active reference or null for status %s',
      async (status) => {
        const reference = await submit();
        await prisma.job.update({ where: { id: reference.jobId }, data: { status } });
        const response = await request(
          `/factors/correlation-jobs/active?${query}`,
          undefined,
          'owner',
          'GET',
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(
          status === 'queued' || status === 'running' ? reference : null,
        );
        expect(
          await (
            await request(`/factors/correlation-jobs/active?${query}`, undefined, 'other', 'GET')
          ).json(),
        ).toBeNull();
        expect(
          await (
            await request(
              '/factors/correlation-jobs/active?keys=foreign,ep',
              undefined,
              'owner',
              'GET',
            )
          ).json(),
        ).toBeNull();
      },
    );

    it('polls correlation logs by jobId and rejects cross-task, cross-owner and invalid cursors', async () => {
      const { jobId } = await submit();
      const logs = [
        { source: 'system', level: 'info', text: 'Started' },
        { source: 'system', level: 'info', text: 'Completed' },
      ];
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', logs: JSON.stringify(logs) },
      });
      const path = `/factors/correlation-jobs/${jobId}`;
      expect(
        await (await request(`${path}?since=1`, undefined, 'owner', 'GET')).json(),
      ).toMatchObject({
        status: 'done',
        logs: [logs[1]],
        nextSince: 2,
      });
      expect(
        await (await request(`${path}?since=2`, undefined, 'owner', 'GET')).json(),
      ).toMatchObject({ logs: [], nextSince: 2 });
      expect((await request(`${path}?since=-1`, undefined, 'owner', 'GET')).status).toBe(400);
      expect((await request(path, undefined, 'other', 'GET')).status).toBe(404);
      expect(
        (await request(`/factors/analysis-jobs/${jobId}`, undefined, 'owner', 'GET')).status,
      ).toBe(404);
      expect(
        (await request('/factors/correlation-jobs/missing', undefined, 'owner', 'GET')).status,
      ).toBe(404);
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'queued', payload: { task: 'analysis' } },
      });
      expect((await request(path, undefined, 'owner', 'GET')).status).toBe(404);
      expect(
        await (
          await request(`/factors/correlation-jobs/active?${query}`, undefined, 'owner', 'GET')
        ).json(),
      ).toBeNull();
      await prisma.job.update({
        where: { id: jobId },
        data: { kind: 'backtest', payload: { task: 'correlation' } },
      });
      expect((await request(path, undefined, 'owner', 'GET')).status).toBe(404);
    });
  });

  it('removes the old report, active-correlation and query-only submission contracts', async () => {
    await seedReport();
    for (const path of [
      '/factors/reports?factor=draft',
      '/factors/reports/report',
      '/factors/correlations/running?keys=ep,bp',
    ]) {
      expect((await request(path, undefined, 'owner', 'GET')).status).toBe(404);
    }
    for (const action of ['holdout', 'reveal']) {
      expect((await request(`/factors/reports/report/${action}`)).status).toBe(404);
    }
    expect((await request('/factors/correlations?keys=ep,bp')).status).toBe(400);
    expect(resources.wake).not.toHaveBeenCalled();
  });

  it('uses the path factor identity when the request body names a different factor', async () => {
    const response = await request('/factors/draft/agent/turns', {
      id: 'foreign',
      code: frozenCode,
      message: 'Explain this factor',
    });
    expect(response.status).toBe(200);
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ entity: { kind: 'factor', id: 'draft' } }),
    );
    expect(
      (
        await request('/factors/missing/agent/turns', {
          id: 'draft',
          code: frozenCode,
          message: 'Explain',
        })
      ).status,
    ).toBe(404);
    expect(
      (await request('/factors/missing/metadata/refresh', { id: 'draft', code: frozenCode }))
        .status,
    ).toBe(404);
    expect(resources.enqueue).toHaveBeenCalledTimes(1);
  });

  it('checks Agent input, ownership, publication and active turns before enqueue', async () => {
    const input = { code: frozenCode, message: 'Explain this factor' };
    expect((await request('/factors/draft/agent/turns', { ...input, message: '' })).status).toBe(
      400,
    );
    expect((await request('/factors/draft/agent/turns', input, 'other')).status).toBe(404);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    resources.running.mockReturnValue('active-turn');
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(400);
    expect(resources.enqueue).not.toHaveBeenCalled();
    resources.running.mockReturnValue(null);
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(200);
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
      (await request('/factors/weather/pins', { factorId: 'draft', direction: 'positive' })).status,
    ).toBe(400);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect(
      (
        await request(
          '/factors/weather/pins',
          { factorId: 'draft', direction: 'positive' },
          'other',
        )
      ).status,
    ).toBe(404);
    const response = await request('/factors/weather/pins', {
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
    const busy = await request(`/factors/weather/pins/${pin.id}`, undefined, 'owner', 'DELETE');
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: { code: 'CONFLICT', message: t('en', 'factorWeatherRunningCannotUnpin') },
    });
    expect(
      (await request(`/factors/weather/pins/${pin.id}/refresh`, undefined, 'other')).status,
    ).toBe(404);
    await request('/factors/weather', undefined, 'owner', 'GET');
    expect(resources.refresh).toHaveBeenCalledTimes(2);
    await prisma.factorWeatherPin.update({ where: { id: pin.id }, data: { status: 'ready' } });
    expect(
      (await request(`/factors/weather/pins/${pin.id}`, undefined, 'owner', 'DELETE')).status,
    ).toBe(200);
  });
});
