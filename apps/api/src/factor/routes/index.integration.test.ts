import { handleApiError } from '#infra/http/errors.js';

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

import { captureEmbeddedContext } from '#research/embedded/context.js';
import { captureFactorQuestionContext } from '../questions/context.js';
import { prisma } from '#infra/database/prisma.js';

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
    await prisma.factor.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.daily.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('protects published definitions and retains reports after draft deletion', async () => {
    await seedReport();
    expect((await request('/factors/draft', undefined, 'other', 'DELETE')).status).toBe(404);

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

  it('reserves collection paths and requires PATCH for factor edits', async () => {
    expect((await request('/factors', undefined, 'owner', 'GET')).status).toBe(200);
    expect((await request('/factors/catalog', undefined, 'owner', 'GET')).status).toBe(200);
    expect((await request('/factors/analysis-reports', undefined, 'owner', 'GET')).status).toBe(
      400,
    );
    expect((await request('/factors/correlations', undefined, 'owner', 'GET')).status).toBe(404);
    expect((await request('/factors/correlations')).status).toBe(404);
    expect((await request('/factors/analyses', {})).status).toBe(400);
    expect((await request('/factors/draft', { name: 'Old method' })).status).toBe(404);
    expect((await request('/factors/composites/missing', { definition: {} })).status).toBe(404);
    expect(
      (await request('/factors/draft/visibility', { visibility: 'private' }, 'owner', 'PATCH'))
        .status,
    ).toBe(404);
    expect((await request('/factors/custom/draft', undefined, 'owner', 'GET')).status).toBe(404);
  });

  it('preserves factor publication error mapping', async () => {
    const response = await request('/factors/missing/publish', { approvedReportId: 'report' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

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
    expect((await request('/factors/correlations?keys=ep,bp')).status).toBe(404);
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

  it.each([
    ['GET', '/factors/composites'],
    ['POST', '/factors/composites'],
    ['GET', '/factors/composites/removed'],
    ['PATCH', '/factors/composites/removed'],
    ['DELETE', '/factors/composites/removed'],
    ['POST', '/factors/composites/removed/copy'],
    ['POST', '/factors/composites/removed/publish'],
    ['POST', '/factors/composites/removed/archive'],
    ['GET', '/factors/correlations'],
    ['POST', '/factors/correlations'],
    ['GET', '/factors/correlation-jobs/active'],
    ['GET', '/factors/correlation-jobs/removed'],
    ['GET', '/factors/weather'],
    ['POST', '/factors/weather/pins'],
    ['POST', '/factors/weather/pins/removed/refresh'],
    ['DELETE', '/factors/weather/pins/removed'],
  ])('retires the %s %s endpoint', async (method, path) => {
    expect((await request(path, undefined, 'owner', method)).status).toBe(404);
  });
});
