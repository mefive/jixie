import { handleApiError } from '#infra/http/errors.js';
import type { FactorPanelCompositeDefinitionV2 } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
  const mocked = { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
vi.mock('#agent/turns/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#agent/turns/run.js')>()),
  enqueueAgentTurn: resources.enqueue,
}));
vi.mock('#agent/turns/bus.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#agent/turns/bus.js')>()),
  findRunning: resources.running,
}));
vi.mock('#jobs/job-scheduler.js', () => ({ JobScheduler: { wake: resources.wake } }));
vi.mock('#jobs/job-logs.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#jobs/job-logs.js')>();
  vi.spyOn(original.JobLogs, 'initialize').mockImplementation(resources.logs);
  return original;
});
vi.mock('../weather/refresh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../weather/refresh.js')>()),
  refreshFactorWeatherPin: resources.refresh,
}));

import { t } from '#i18n/index.js';
import { captureEmbeddedContext } from '#research/embedded/context.js';
import { captureFactorQuestionContext } from '../questions/context.js';
import { prisma } from '#infra/database/prisma.js';
import { copyFactorComposite } from '../composition/operations.js';
import { sha256 } from '../sources/fingerprint.js';
import { factorRoute } from './index.js';

const app = new Hono().onError(handleApiError);
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
const frozenCode = 'export default defineFactor({ name: "Frozen", compute: () => 1 });';
async function seedReport() {
  return prisma.factorReport.create({
    data: {
      id: 'report',
      userId: 'owner',
      factor: 'draft',
      legacyStatus: 'done',
      freq: 'month',
      start: '20200101',
      end: '20231229',
      factorCodeSnapshot: frozenCode,
      factorCodeHash: sha256(frozenCode),
      dataRevision: 'fixture-vintage',
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
async function seedForeignComposite() {
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
    key: 'owned_panel',
    name: 'Owned panel',
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
    expect(pinned.status).toBe(409);
    expect(await pinned.json()).toEqual({
      error: { code: 'CONFLICT', message: t('en', 'pinnedFactorReadonlyEdit') },
    });
    expect((await request('/factors/draft', undefined, 'other', 'DELETE')).status).toBe(404);
    await prisma.factorWeatherPin.deleteMany();
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'published' } });
    expect((await request('/factors/draft', { name: 'Changed' }, 'owner', 'PATCH')).status).toBe(
      409,
    );
    expect((await request('/factors/draft', undefined, 'owner', 'DELETE')).status).toBe(409);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    expect((await request('/factors/draft', undefined, 'owner', 'DELETE')).status).toBe(200);
    expect(await prisma.factorReport.findUnique({ where: { id: 'report' } })).not.toBeNull();
  });

  it('rejects foreign published factor reads and copies while preserving own copies', async () => {
    await prisma.factor.update({
      where: { id: 'draft' },
      data: {
        status: 'published',
        messages: [{ role: 'user', content: 'Private' }],
        language: 'python',
        runtimeVersion: 'py-v1',
      },
    });
    expect((await request('/factors/draft', undefined, 'other', 'GET')).status).toBe(404);
    expect((await request('/factors/draft/copy', undefined, 'other')).status).toBe(404);
    await expect(
      captureFactorQuestionContext(prisma, 'other', 'draft', undefined, 'en'),
    ).rejects.toMatchObject({ reason: 'factor_not_found' });
    await expect(
      captureEmbeddedContext(prisma, 'other', { type: 'factor', id: 'draft' }),
    ).rejects.toMatchObject({ reason: 'embedded_not_found' });
    const source = await prisma.factor.findUniqueOrThrow({ where: { id: 'draft' } });
    const copied = await request('/factors/draft/copy');
    expect(copied.status).toBe(200);
    const { id } = await copied.json();
    expect(await prisma.factor.findUniqueOrThrow({ where: { id } })).toMatchObject({
      userId: 'owner',
      status: 'draft',
      code: frozenCode,
      language: 'python',
      runtimeVersion: 'py-v1',
      messages: source.messages,
    });
    expect(await prisma.factor.findUniqueOrThrow({ where: { id: 'draft' } })).toEqual(source);
  });

  it('rejects reading and copying a foreign published composite', async () => {
    await seedForeignComposite();
    const before = await prisma.factor.findMany({ orderBy: { id: 'asc' } });
    expect((await request('/factors/composites/composite', undefined, 'owner', 'GET')).status).toBe(
      404,
    );
    expect((await request('/factors/composites/composite/copy')).status).toBe(404);
    await expect(
      captureFactorQuestionContext(prisma, 'owner', 'composite', undefined, 'en'),
    ).rejects.toMatchObject({ reason: 'factor_not_found' });
    await expect(
      captureEmbeddedContext(prisma, 'owner', { type: 'factor', id: 'composite' }),
    ).rejects.toMatchObject({ reason: 'embedded_not_found' });
    expect(await prisma.factor.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.factorComposite.count()).toBe(1);
  });

  it('copies an owned published composite without copying its components', async () => {
    await seedForeignComposite();
    await prisma.factor.updateMany({
      where: { id: { in: ['component_a', 'component_b'] } },
      data: { userId: 'owner' },
    });
    await prisma.factorComposite.update({ where: { id: 'composite' }, data: { userId: 'owner' } });
    const source = await prisma.factorComposite.findUniqueOrThrow({ where: { id: 'composite' } });
    const copy = await copyFactorComposite('owner', 'composite');
    expect(copy).toMatchObject({ status: 'draft', key: 'owned_panel_v2' });
    expect((copy.definition as FactorPanelCompositeDefinitionV2).components).toEqual(
      (source.definition as unknown as FactorPanelCompositeDefinitionV2).components,
    );
    expect(await prisma.factor.count()).toBe(3);
    expect(await prisma.factorComposite.findUniqueOrThrow({ where: { id: 'composite' } })).toEqual(
      source,
    );
  });

  it.each([
    {
      specJson: null,
      freq: 'week',
      neutral: 'size_industry',
      expectedFreq: 'week',
      expectedNeutral: 'size_industry',
    },
    {
      specJson: '{',
      freq: 'day',
      neutral: 'unknown',
      expectedFreq: 'month',
      expectedNeutral: 'none',
    },
    {
      specJson: '{"version":99}',
      freq: 'month',
      neutral: 'size',
      expectedFreq: 'month',
      expectedNeutral: 'size',
    },
  ])(
    'reads legacy parameter columns when specJson is $specJson',
    async ({ specJson, freq, neutral, expectedFreq, expectedNeutral }) => {
      await seedReport();
      await prisma.factorReport.update({
        where: { id: 'report' },
        data: { specJson, freq, neutral },
      });
      const protocol = {
        version: 1,
        freq: expectedFreq,
        neutral: expectedNeutral,
        start: '20200101',
        end: '20231229',
      };
      const researchSpec = { version: 1, analysisKind: 'cross_sectional', protocol };

      const detailResponse = await request(
        '/factors/analysis-reports/report',
        undefined,
        'owner',
        'GET',
      );
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toMatchObject({
        spec: protocol,
        researchSpec,
        payload: { label: 'Frozen', icMean: 0.125 },
        factorCodeSnapshot: frozenCode,
        factorCodeHash: sha256(frozenCode),
      });
      const listResponse = await request(
        '/factors/analysis-reports?factor=draft',
        undefined,
        'owner',
        'GET',
      );
      expect(listResponse.status).toBe(200);
      expect((await listResponse.json()).items).toMatchObject([
        { id: 'report', spec: protocol, researchSpec },
      ]);
    },
  );

  it('accepts explicit recent dates without a card and permits a new run after completion', async () => {
    const input = {
      factor: 'draft',
      spec: { version: 1, freq: 'month', neutral: 'none', start: '20240101', end: '20250630' },
    };
    const firstResponse = await request('/factors/analyses', input);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ status: 'running', reusedRunning: false });
    const report = await prisma.factorReport.findUniqueOrThrow({
      where: { id: first.reportId },
      include: { job: true },
    });
    expect(report).toMatchObject({
      start: '20240101',
      end: '20250630',
      factorCodeSnapshot: frozenCode,
      job: { id: first.jobId, status: 'queued' },
    });

    const reused = await (await request('/factors/analyses', input)).json();
    expect(reused).toMatchObject({
      reportId: first.reportId,
      jobId: first.jobId,
      reusedRunning: true,
    });
    expect(resources.wake).toHaveBeenCalledTimes(1);

    await prisma.job.update({ where: { id: first.jobId }, data: { status: 'done' } });
    await prisma.factorReport.update({
      where: { id: first.reportId },
      data: { payload: JSON.stringify({ icMean: -0.1 }) },
    });
    const repeated = await (await request('/factors/analyses', input)).json();
    expect(repeated.reportId).not.toBe(first.reportId);
    expect(repeated.reusedRunning).toBe(false);
    expect(resources.wake).toHaveBeenCalledTimes(2);
    expect(await prisma.factorReport.count()).toBe(1);
    expect(await prisma.job.findUnique({ where: { id: first.jobId } })).toBeNull();
    expect(
      (await request(`/factors/analysis-reports/${first.reportId}`, undefined, 'owner', 'GET'))
        .status,
    ).toBe(404);
    expect(
      (await request(`/factors/analysis-reports/${repeated.reportId}`, undefined, 'owner', 'GET'))
        .status,
    ).toBe(200);
  });

  it('returns owned report results and logs without a reveal step', async () => {
    await seedReport();
    const logs = [{ source: 'system', level: 'info', text: 'Rank IC: 0.125' }];
    await prisma.job.create({
      data: {
        id: 'job',
        userId: 'owner',
        kind: 'factor-analysis',
        key: 'fixture',
        status: 'done',
        factorReportId: 'report',
        logs: JSON.stringify(logs),
      },
    });

    const list = await (
      await request('/factors/analysis-reports?factor=draft', undefined, 'owner', 'GET')
    ).json();
    expect(list.items[0]).toMatchObject({ metrics: { rankIc: 0.125 } });
    const detail = await (
      await request('/factors/analysis-reports/report', undefined, 'owner', 'GET')
    ).json();
    expect(detail).toMatchObject({
      payload: { icMean: 0.125 },
      researchPayload: { analysisKind: 'cross_sectional' },
    });
    for (const key of [
      'phase',
      'sealed',
      'canReveal',
      'researchIntent',
      'holdout',
      'parentReportId',
    ]) {
      expect(detail).not.toHaveProperty(key);
    }
    expect(
      await (await request('/factors/analysis-jobs/job', undefined, 'owner', 'GET')).json(),
    ).toMatchObject({ logs });

    for (const resource of ['analysis-reports/report', 'analysis-jobs/job']) {
      expect((await request(`/factors/${resource}`, undefined, 'other', 'GET')).status).toBe(404);
    }
    expect((await request('/factors/correlation-jobs/job', undefined, 'owner', 'GET')).status).toBe(
      404,
    );
  });

  it('retires research windows, trial counts, holdout submission and reveal APIs', async () => {
    await seedReport();

    for (const [path, method] of [
      ['research/window', 'GET'],
      ['research/summary', 'GET'],
      ['analysis-reports/report/holdout', 'POST'],
      ['analysis-reports/report/reveal', 'POST'],
    ]) {
      expect((await request(`/factors/${path}`, undefined, 'owner', method)).status).toBe(404);
    }
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
    ).toBe(404);
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
    'reads owned analysis jobs with historical payloads: %j',
    async (payload) => {
      await seedReport();
      const logs = [{ source: 'system', level: 'info', text: 'Analysis complete' }];
      await prisma.job.create({
        data: {
          id: 'analysis-job',
          userId: 'owner',
          kind: 'factor-analysis',
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

  it('rejects foreign report relations and analysis jobs passed to correlation polling', async () => {
    await seedReport();
    await prisma.job.create({
      data: {
        id: 'job',
        userId: 'other',
        kind: 'factor-analysis',
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
      data: { userId: 'owner', kind: 'factor-correlation' },
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
        kind: 'factor-correlation',
        key: 'corr|bp,ep|month|20150101|20261231',
        payload: {
          keys: ['ep', 'bp'],
          freq: 'month',
          start: '20150101',
          end: '20261231',
        },
      });
      expect(
        (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).payload,
      ).not.toHaveProperty('task');
      expect(resources.wake).toHaveBeenCalledOnce();
      expect(resources.logs).not.toHaveBeenCalled();
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

    it('reuses an active correlation job with a historical payload and rejects report-linked candidates', async () => {
      const reference = await submit();
      const job = await prisma.job.findUniqueOrThrow({ where: { id: reference.jobId } });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          kind: 'factor-correlation',
          payload: { ...(job.payload as Prisma.InputJsonObject), task: 'correlation' },
        },
      });
      expect(await submit()).toEqual(reference);
      expect(await prisma.job.count()).toBe(1);
      expect(
        await (
          await request(`/factors/correlation-jobs/active?${query}`, undefined, 'owner', 'GET')
        ).json(),
      ).toEqual(reference);

      await seedReport();
      await prisma.job.update({ where: { id: job.id }, data: { factorReportId: 'report' } });
      expect(
        (await request(`/factors/correlation-jobs/${job.id}`, undefined, 'owner', 'GET')).status,
      ).toBe(404);
      expect(
        await (
          await request(`/factors/correlation-jobs/active?${query}`, undefined, 'owner', 'GET')
        ).json(),
      ).toBeNull();
      expect((await submit()).jobId).not.toBe(job.id);
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
        const invalid = await request(
          '/factors/correlation-jobs/active?keys=foreign,ep',
          undefined,
          'owner',
          'GET',
        );
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toEqual({
          error: {
            code: 'VALIDATION_FAILED',
            message: t('en', 'unknownFactor', { factor: 'foreign' }),
          },
        });
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
        data: { status: 'queued', kind: 'factor-analysis' },
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
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(409);
    await prisma.factor.update({ where: { id: 'draft' }, data: { status: 'draft' } });
    resources.running.mockReturnValue('active-turn');
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(409);
    expect(resources.enqueue).not.toHaveBeenCalled();
    resources.running.mockReturnValue(null);
    expect((await request('/factors/draft/agent/turns', input)).status).toBe(200);
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        entity: { kind: 'factor', id: 'draft' },
        currentCode: frozenCode,
        locale: 'en',
        codeProposal: expect.objectContaining({
          surface: 'factor',
          entityId: 'draft',
          beforeCode: frozenCode,
          baseIdentity: expect.any(String),
        }),
      }),
    );
  });

  it('keeps weather ownership, frozen snapshots, detached refresh and busy errors', async () => {
    expect(
      (await request('/factors/weather/pins', { factorId: 'draft', direction: 'positive' })).status,
    ).toBe(409);
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
