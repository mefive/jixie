import { seedBuiltinFactors } from '#factor/definitions/seed.js';
import type { ResearchSandbox } from '../sandbox/research-sandbox.js';
import type { ResearchCellRunResult, ResearchCellInput } from '../sandbox/contract.js';
import { researchSandboxPool } from '../sandbox/research-sandbox-pool.js';
import type { ResearchCellRunOptions } from '../sandbox/contract.js';
import { handleApiError } from '#infra/http/errors.js';
import type { ResearchEmbeddedRunSummaryV1, ResearchEmbeddedRunV1 } from '@jixie/shared';
import { embeddedCreateSchema } from '@jixie/shared/api/research';
import { RESEARCH_EMBEDDED_LIMITS } from '@jixie/shared';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-embedded-lifecycle-');
  writeFileSync(`${fixture.directory}/test.db`, '');
  vi.stubEnv('DATABASE_URL', `file:${fixture.directory}/test.db`);
  const mocked = {
    prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/test.db` }),
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});
vi.mock('#jobs/job-scheduler.js', () => ({ JobScheduler: { wake: vi.fn() } }));
vi.mock('#agent/turns/run.js', async (original) => ({
  ...(await original<typeof import('#agent/turns/run.js')>()),
  enqueueAgentTurn: vi.fn(),
}));

import { prisma } from '#infra/database/prisma.js';
import { registerJobLifecycles } from '#jobs/register.js';
import { JobService } from '#jobs/job-service.js';
import { researchRoute } from '../routes/index.js';

import { dispatchResearchRequest } from '../sandbox/host/dispatch.js';
import { cancelEmbeddedRun } from './cancel.js';
import { getEmbeddedRun, getEmbeddedVersion } from './read.js';
import { submitEmbeddedRun } from './submit.js';
import {
  createEmbeddedAnalysis,
  deriveEmbeddedVersion,
  updateEmbeddedVersion,
} from './versions.js';

const app = new Hono().onError(handleApiError);
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-user') ?? 'owner');
  await next();
});
app.route('/research', researchRoute);
const input = {
  title: 'Inspect sample',
  host: { type: 'factor' as const, id: 'factor' },
  source: 'parameters["window"]',
  parameters: { window: 3 },
  inputScope: 'Three observations',
};
const draft = { source: input.source, parameters: input.parameters, inputScope: input.inputScope };
let executeSpy: Mock<
  (
    documentId: string,
    cell: ResearchCellInput,
    options?: ResearchCellRunOptions,
  ) => Promise<ResearchCellRunResult>
>;

function request(path: string, method = 'GET', body?: unknown, userId = 'owner', locale = 'en') {
  return app.request(`/research${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'accept-language': locale, 'x-user': userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function fixtureRun(source = input.source) {
  const created = await createEmbeddedAnalysis('owner', { ...input, source });
  const run = await submitEmbeddedRun('owner', created.analysis.id, created.version.id, {
    requestId: 'initial',
    expectedRevision: 1,
  });
  return { ...created, run };
}
async function execute(run: ResearchEmbeddedRunSummaryV1) {
  expect(await JobService.claim(run.jobId)).toBe(true);
  await JobService.execute(run.jobId);
  expect((await prisma.job.findUniqueOrThrow({ where: { id: run.jobId } })).payload).toBeNull();
  return getEmbeddedRun('owner', run.analysisId, run.runId);
}
async function capture() {
  return {
    outputs: [{ type: 'value' as const, value: 3 }],
    definitions: ['parameters'],
    references: [],
  };
}
function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolveValue = resolvePromise;
  });
  return { promise, resolve: resolveValue };
}

describe('embedded analysis storage, queue and HTTP lifecycle', () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/test.db` }, stdio: 'pipe' },
    );
  }, 60_000);
  beforeEach(async () => {
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid' },
        { id: 'other', email: 'other@fixture.invalid' },
      ],
    });
    await prisma.factor.createMany({
      data: [
        { id: 'factor', userId: 'owner', key: 'fixture', name: 'Fixture', code: 'factor source' },
        {
          id: 'builtin-factor',
          userId: 'builtin',
          key: 'builtin-fixture',
          name: 'Builtin',
          code: 'builtin source',
          status: 'published',
        },
      ],
    });
    executeSpy = vi
      .fn<
        (
          documentId: string,
          cell: ResearchCellInput,
          options?: ResearchCellRunOptions,
        ) => Promise<ResearchCellRunResult>
      >()
      .mockImplementation(async (_documentId, _cell, _options) => capture());
    vi.spyOn(researchSandboxPool, 'withSandbox').mockImplementation(async (documentId, operation) =>
      operation({
        execute: ({ cell }, options) => executeSpy(documentId, cell, options),
      } as ResearchSandbox),
    );
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await prisma.researchExecution.deleteMany();
    await prisma.researchEmbeddedAnalysisVersion.deleteMany();
    await prisma.researchEmbeddedAnalysis.deleteMany();
    await prisma.factor.deleteMany();
    await prisma.factorReport.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllEnvs();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('validates and normalizes external creation input before creating records', async () => {
    for (const invalid of [
      { ...input, source: '' },
      { ...input, source: 'x'.repeat(RESEARCH_EMBEDDED_LIMITS.sourceCharacters + 1) },
      { ...input, parameters: { nested: {} } },
      { ...input, unexpected: true },
    ]) {
      expect(embeddedCreateSchema.safeParse(invalid).success).toBe(false);
    }
    expect(await prisma.researchEmbeddedAnalysis.count()).toBe(0);
    expect(await prisma.researchDocument.count()).toBe(0);

    expect((await request('/embedded-analyses', 'POST', input)).status).toBe(404);
    expect(await prisma.researchEmbeddedAnalysis.count()).toBe(0);
    await createEmbeddedAnalysis(
      'owner',
      embeddedCreateSchema.parse({
        ...input,
        title: '  Inspect sample  ',
        inputScope: '  Three observations  ',
      }),
    );
    expect(await prisma.researchEmbeddedAnalysis.findFirstOrThrow()).toMatchObject({
      title: input.title,
    });
    expect(await prisma.researchEmbeddedAnalysisVersion.findFirstOrThrow()).toMatchObject({
      inputScope: input.inputScope,
    });
  });

  it('validates inherited database drafts before allocating another version', async () => {
    const created = await createEmbeddedAnalysis('owner', input);
    await prisma.researchEmbeddedAnalysisVersion.update({
      where: { id: created.version.id },
      data: { parameters: { invalid: { nested: true } } },
    });
    const documentsBefore = await prisma.researchDocument.count();

    await expect(
      deriveEmbeddedVersion('owner', created.analysis.id, {
        parentVersionId: created.version.id,
      }),
    ).rejects.toThrow();

    expect(await prisma.researchEmbeddedAnalysisVersion.count()).toBe(1);
    expect(await prisma.researchDocument.count()).toBe(documentsBefore);
    expect(
      await prisma.researchEmbeddedAnalysis.findUniqueOrThrow({
        where: { id: created.analysis.id },
      }),
    ).toMatchObject({ nextVersion: 2 });
  });

  it('snapshots before execution, deduplicates submission and blocks edits while queued', async () => {
    const { analysis, version, run } = await fixtureRun();
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toMatchObject({
      source: input.source,
      parameters: input.parameters,
      status: 'queued',
      revision: 1,
    });
    expect(
      await submitEmbeddedRun('owner', analysis.id, version.id, {
        requestId: 'initial',
        expectedRevision: 1,
      }),
    ).toEqual(run);
    await expect(
      submitEmbeddedRun('owner', analysis.id, version.id, {
        requestId: 'initial',
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ reason: 'embedded_request_conflict' });
    await expect(
      submitEmbeddedRun('owner', analysis.id, version.id, {
        requestId: 'second',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ reason: 'embedded_run_in_progress' });
    await expect(
      updateEmbeddedVersion('owner', analysis.id, version.id, {
        ...draft,
        source: '2',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ reason: 'embedded_run_in_progress' });
    expect(await prisma.researchExecution.count()).toBe(1);
  });
  it('edits successful drafts and replaces only their previous terminal run', async () => {
    const { analysis, version, run } = await fixtureRun();
    expect(await execute(run)).toMatchObject({
      status: 'success',
      outputs: [{ type: 'value', value: 3 }],
    });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: run.jobId } })).payload).toBeNull();
    const edited = await updateEmbeddedVersion('owner', analysis.id, version.id, {
      ...draft,
      source: '99',
      expectedRevision: 1,
    });
    expect(edited).toMatchObject({ revision: 2, source: '99' });
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toMatchObject({
      revision: 1,
      source: '99',
    });
    const second = await submitEmbeddedRun('owner', analysis.id, version.id, {
      requestId: 'second',
      expectedRevision: 2,
    });
    await expect(getEmbeddedRun('owner', analysis.id, run.runId)).rejects.toMatchObject({
      reason: 'embedded_not_found',
    });
    expect(await prisma.job.findUnique({ where: { id: run.jobId } })).toBeNull();
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: second.jobId } })).payload,
    ).toMatchObject({ source: '99', parameters: input.parameters, revision: 2 });
    await execute(second);
    const derived = await deriveEmbeddedVersion('owner', analysis.id, {
      parentVersionId: version.id,
    });
    expect(derived).toMatchObject({ number: 2, parentVersionId: version.id, source: '99' });
    expect(await getEmbeddedRun('owner', analysis.id, second.runId)).toMatchObject({
      status: 'success',
    });
  });

  it('retains failed source and permits repair without creating another version', async () => {
    executeSpy.mockRejectedValueOnce(new Error('Invalid Python syntax'));
    const { analysis, version, run } = await fixtureRun('if');
    const failed = await execute(run);
    expect(failed).toMatchObject({ status: 'error', errorCode: 'execution_failed', source: 'if' });
    const repaired = await updateEmbeddedVersion('owner', analysis.id, version.id, {
      ...draft,
      expectedRevision: 1,
    });
    expect(repaired).toMatchObject({ revision: 2 });
    await expect(
      updateEmbeddedVersion('owner', analysis.id, version.id, { ...draft, expectedRevision: 1 }),
    ).rejects.toMatchObject({ reason: 'embedded_revision_conflict' });
    const rerun = await submitEmbeddedRun('owner', analysis.id, version.id, {
      requestId: 'repair',
      expectedRevision: 2,
    });
    expect((await execute(rerun)).status).toBe('success');
    await expect(getEmbeddedRun('owner', analysis.id, run.runId)).rejects.toMatchObject({
      reason: 'embedded_not_found',
    });
  });
  it('reads current SDK responses without storing input replay data', async () => {
    await prisma.factorReport.create({
      data: {
        id: 'report',
        userId: 'owner',
        factor: 'fixture',
        legacyStatus: 'done',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{"icMean":0.05}',
      },
    });
    executeSpy.mockImplementationOnce(async (documentId) => {
      const frame = {
        type: 'request' as const,
        id: 1,
        method: 'research_factor_report' as const,
        arguments: { report_id: 'report' },
      };
      expect(await dispatchResearchRequest(documentId, frame)).toMatchObject({
        result: { report: { ic_mean: 0.05 } },
      });
      await prisma.factorReport.delete({ where: { id: 'report' } });
      expect(await dispatchResearchRequest(documentId, frame)).toMatchObject({
        error: expect.stringContaining('not found'),
      });
      return capture();
    });
    const { run } = await fixtureRun();
    const completed = await execute(run);
    for (const field of ['inputs', 'environment', 'context', 'sourceHash']) {
      expect(completed).not.toHaveProperty(field);
    }
  });

  it('rejects foreign sources and unfinished report context without creating orphan documents', async () => {
    await expect(createEmbeddedAnalysis('other', input)).rejects.toMatchObject({
      reason: 'embedded_not_found',
    });
    await prisma.factorReport.create({
      data: {
        id: 'incomplete',
        legacyStatus: 'error',
        userId: 'owner',
        factor: 'fixture',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{}',
      },
    });
    await expect(
      createEmbeddedAnalysis('owner', { ...input, reportId: 'incomplete' }),
    ).rejects.toMatchObject({ reason: 'embedded_invalid_report', embeddedCode: 'invalid_report' });
    expect(await prisma.researchDocument.count()).toBe(0);
    const builtin = await createEmbeddedAnalysis('other', {
      ...input,
      host: { type: 'factor', id: 'builtin-factor' },
    });
    await expect(
      getEmbeddedVersion('owner', builtin.analysis.id, builtin.version.id),
    ).rejects.toMatchObject({ reason: 'embedded_not_found' });
    expect(
      (await prisma.factor.findUniqueOrThrow({ where: { id: 'builtin-factor' } })).messages,
    ).toBeNull();
  });

  it('accepts code-backed preset identities and rejects a report from another Factor', async () => {
    await seedBuiltinFactors();
    const preset = await createEmbeddedAnalysis('owner', {
      ...input,
      host: { type: 'factor', id: 'etf_trend_20' },
    });
    expect(preset.version).not.toHaveProperty('context');
    expect(await prisma.factor.findUnique({ where: { id: 'etf_trend_20' } })).toMatchObject({
      userId: 'builtin',
      status: 'published',
    });
    await prisma.factorReport.create({
      data: {
        id: 'unrelated',
        userId: 'owner',
        factor: 'some-other-factor',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{}',
      },
    });
    await expect(
      createEmbeddedAnalysis('owner', { ...input, reportId: 'unrelated' }),
    ).rejects.toMatchObject({ reason: 'embedded_invalid_report', embeddedCode: 'invalid_report' });
  });

  it('preserves report ownership inside Python SDK requests', async () => {
    await prisma.factorReport.create({
      data: {
        id: 'foreign-report',
        legacyStatus: 'done',
        userId: 'other',
        factor: 'fixture',
        freq: 'month',
        start: '20200101',
        end: '20251231',
        payload: '{"secret":42}',
      },
    });
    executeSpy.mockImplementationOnce(async (documentId, _cell, _options) => {
      const send = vi.fn();
      const response = await dispatchResearchRequest(documentId, {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: { report_id: 'foreign-report' },
      });
      await send(response);
      expect(send.mock.calls[0][0]).toMatchObject({ error: expect.stringContaining('not found') });
      expect(JSON.stringify(send.mock.calls)).not.toContain('secret');
      return capture();
    });
    const { run } = await fixtureRun();
    expect((await execute(run)).status).toBe('success');
  });

  it('cancels queued jobs idempotently and never starts their Python', async () => {
    const { analysis, version, run } = await fixtureRun();
    const cancelled = await cancelEmbeddedRun('owner', analysis.id, run.runId);
    expect(cancelled.status).toBe('cancelled');
    expect(await cancelEmbeddedRun('owner', analysis.id, run.runId)).toEqual(cancelled);
    expect(await JobService.claim(run.jobId)).toBe(false);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(await getEmbeddedVersion('owner', analysis.id, version.id)).not.toHaveProperty(
      'frozenAt',
    );
  });

  it('cancels active work and rejects late output without freezing or overwriting the record', async () => {
    const started = deferred<void>();
    const late = deferred<ResearchCellRunResult>();
    executeSpy.mockImplementationOnce(async (_documentId, _cell, _options) => {
      started.resolve();
      return late.promise;
    });
    const { analysis, version, run } = await fixtureRun();
    const running = execute(run);
    await started.promise;
    await cancelEmbeddedRun('owner', analysis.id, run.runId);
    const cancelled = await running;
    expect(cancelled.status).toBe('cancelled');
    late.resolve(await capture());
    await Promise.resolve();
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toEqual(cancelled);
    expect(await getEmbeddedVersion('owner', analysis.id, version.id)).not.toHaveProperty(
      'frozenAt',
    );
  });

  it('fails a legacy queued payload explicitly and clears its claim and temporary input', async () => {
    const { analysis, run } = await fixtureRun();
    await prisma.job.update({ where: { id: run.jobId }, data: { payload: { runId: run.runId } } });
    expect(await execute(run)).toMatchObject({ status: 'error', errorCode: 'execution_failed' });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(
      await prisma.researchEmbeddedAnalysis.findUniqueOrThrow({ where: { id: analysis.id } }),
    ).toMatchObject({ activeRunId: null });
  });

  it('recovers interrupted jobs while leaving queued submissions available after restart', async () => {
    const first = await fixtureRun();
    const second = await fixtureRun();
    await prisma.job.update({ where: { id: first.run.jobId }, data: { status: 'running' } });
    expect(await JobService.recoverInterrupted()).toBe(1);
    expect(await getEmbeddedRun('owner', first.analysis.id, first.run.runId)).toMatchObject({
      status: 'cancelled',
      errorCode: 'interrupted',
    });
    expect((await getEmbeddedRun('owner', second.analysis.id, second.run.runId)).status).toBe(
      'queued',
    );
    expect((await execute(second.run)).status).toBe('success');
  });

  it.each([
    ['unknown-kind', 'execute'],
    ['backtest', 'execute'],
    ['unknown-kind', 'recover'],
    ['backtest', 'recover'],
  ] as const)(
    'cleans persisted Embedded links for corrupt %s metadata during %s',
    async (kind, action) => {
      const { run, analysis } = await fixtureRun();
      if (action === 'execute') {
        await JobService.claim(run.jobId);
      }
      await prisma.job.update({
        where: { id: run.jobId },
        data: { kind, payload: { invalid: true }, status: 'running' },
      });

      if (action === 'recover') {
        await JobService.recoverInterrupted();
      } else {
        await JobService.execute(run.jobId);
      }

      expect(executeSpy).not.toHaveBeenCalled();
      expect(await prisma.job.findUniqueOrThrow({ where: { id: run.jobId } })).toMatchObject({
        status: action === 'recover' ? 'stale' : 'error',
      });
      expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toMatchObject({
        status: action === 'recover' ? 'cancelled' : 'error',
        errorCode: action === 'recover' ? 'interrupted' : 'execution_failed',
      });
      expect(
        await prisma.researchEmbeddedAnalysis.findUniqueOrThrow({ where: { id: analysis.id } }),
      ).toMatchObject({ activeRunId: null });
    },
  );

  it('ends the execution deadline even if a dataset request never settles', async () => {
    const started = deferred<void>();
    const late = deferred<ResearchCellRunResult>();
    executeSpy.mockImplementationOnce(async (_documentId, _cell, _options) => {
      started.resolve();
      return late.promise;
    });
    const { run, analysis, version } = await fixtureRun();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const running = execute(run);
    await started.promise;
    await vi.advanceTimersByTimeAsync(RESEARCH_EMBEDDED_LIMITS.executionMilliseconds + 1);
    vi.useRealTimers();
    expect(await running).toMatchObject({ status: 'error', errorCode: 'timeout' });
    late.resolve(await capture());
    expect(await getEmbeddedVersion('owner', analysis.id, version.id)).not.toHaveProperty(
      'frozenAt',
    );
  });

  it('retains analysis evidence when the host is deleted and keeps it private to its owner', async () => {
    const { run, analysis } = await fixtureRun();
    const completed = await execute(run);
    await prisma.factor.delete({ where: { id: input.host.id } });
    expect(await getEmbeddedRun('owner', analysis.id, run.runId)).toEqual(completed);
    expect(
      (await request(`/embedded-analyses/${analysis.id}`, 'GET', undefined, 'other')).status,
    ).toBe(404);
  });

  it('permits only one active run for concurrent submissions', async () => {
    const { analysis, version } = await createEmbeddedAnalysis('owner', input);
    const results = await Promise.allSettled([
      submitEmbeddedRun('owner', analysis.id, version.id, {
        requestId: 'left',
        expectedRevision: 1,
      }),
      submitEmbeddedRun('owner', analysis.id, version.id, {
        requestId: 'right',
        expectedRevision: 1,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.researchExecution.count({ where: { embeddedVersionId: version.id } })).toBe(
      1,
    );
  });

  it('does not freeze if output materialization fails', async () => {
    executeSpy.mockImplementationOnce(async (_documentId, _cell, _options) => ({
      ...(await capture()),
      outputs: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 1) }],
    }));
    const { analysis, version, run } = await fixtureRun();
    expect((await execute(run)).status).toBe('error');
    expect(await getEmbeddedVersion('owner', analysis.id, version.id)).not.toHaveProperty(
      'frozenAt',
    );
    expect(
      (await prisma.researchEmbeddedAnalysis.findUniqueOrThrow({ where: { id: analysis.id } }))
        .activeRunId,
    ).toBeNull();
  });

  it('serves owner-scoped APIs and localized errors, while ordinary document APIs cannot mutate embedded versions', async () => {
    const { analysis, version } = await createEmbeddedAnalysis('owner', input);
    expect((await request(`/embedded-analyses/${analysis.id}/versions`)).status).toBe(404);
    const stored = await prisma.researchEmbeddedAnalysisVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: { document: { include: { cells: true } } },
    });
    expect(await (await request('/documents')).json()).toEqual([]);
    expect((await request(`/documents/${stored.documentId}`, 'DELETE')).status).toBe(404);
    expect(
      (await request(`/documents/${stored.documentId}`, 'PATCH', { title: 'Overwrite' })).status,
    ).toBe(404);
    expect(
      (
        await request(`/documents/${stored.documentId}/cells`, 'POST', {
          kind: 'python',
          source: '99',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/cells/${stored.document.cells[0].id}`, 'PATCH', {
          source: '99',
          expectedRevision: 1,
        })
      ).status,
    ).toBe(404);
    expect((await request(`/cells/${stored.document.cells[0].id}`, 'DELETE')).status).toBe(404);
    expect(
      (await request(`/documents/${stored.documentId}/run`, 'POST', { clean: true })).status,
    ).toBe(404);
    expect((await request(`/documents/${stored.documentId}/archive`, 'POST')).status).toBe(404);
    expect((await request(`/documents/${stored.documentId}/restore`, 'POST')).status).toBe(404);
    const submitted = await request(
      `/embedded-analyses/${analysis.id}/versions/${version.id}/runs`,
      'POST',
      { requestId: 'http', expectedRevision: 1 },
    );
    expect(submitted.status).toBe(202);
    const run = (await submitted.json()) as ResearchEmbeddedRunSummaryV1;
    await execute(run);
    expect(
      (
        await request(`/executions/${run.runId}/promote`, 'POST', {
          displayName: 'Bypass',
          tags: [],
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/embedded-analyses/${analysis.id}`, 'GET', undefined, 'other')).status,
    ).toBe(404);
    const conflict = await request(
      `/embedded-analyses/${analysis.id}/versions/${version.id}`,
      'PATCH',
      { ...input, host: undefined, title: undefined, expectedRevision: 1 },
      'owner',
      'zh',
    );
    expect(conflict.status).toBe(200);
    expect(await conflict.json()).toMatchObject({ revision: 2 });
    const saved = (await (
      await request(`/embedded-analyses/${analysis.id}/runs/${run.runId}`)
    ).json()) as ResearchEmbeddedRunV1;
    expect(saved).toMatchObject({ status: 'success', source: input.source });
    expect(
      (
        await request(
          `/embedded-analyses/${analysis.id}/runs/${run.runId}`,
          'GET',
          undefined,
          'other',
        )
      ).status,
    ).toBe(404);
  });
});

registerJobLifecycles();
