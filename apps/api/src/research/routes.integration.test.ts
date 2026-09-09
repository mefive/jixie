import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { Prisma } from '@prisma/client';
import type { ResearchClarificationV1 } from '@jixie/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ directory: '', sequence: 0 }));
const resources = vi.hoisted(() => ({
  enqueue: vi.fn(),
  running: vi.fn(),
  close: vi.fn(),
  wake: vi.fn(),
  logs: vi.fn(),
  id: vi.fn(),
}));
vi.mock('ulid', () => ({ ulid: resources.id }));
vi.mock('../infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: packageExports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-research-http-');
  const databasePath = `${fixture.directory}/research.db`;
  writeFileSync(databasePath, '');
  return { prisma: new packageExports.PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});
vi.mock('../agent/turns/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/turns/run.js')>()),
  enqueueAgentTurn: resources.enqueue,
}));
vi.mock('../agent/turns/bus.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/turns/bus.js')>()),
  findRunning: resources.running,
}));
vi.mock('./execution/python-session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./execution/python-session.js')>()),
  closeResearchDocumentRuntime: resources.close,
}));
vi.mock('../infra/jobs/queue.js', () => ({ wakeJobQueue: resources.wake }));
vi.mock('../infra/jobs/logs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infra/jobs/logs.js')>()),
  initializeJobLogs: resources.logs,
}));

import { prisma } from '../infra/database/prisma.js';
import { t } from '../i18n/index.js';
import { submitResearchCuratorRun } from './curator/submit.js';
import { finishResearchDocumentRun, startResearchDocumentRun } from './execution/run-state.js';
import { researchRoute } from './routes.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/research', researchRoute);
function request(path: string, body?: unknown, userId = 'owner', method = 'POST') {
  return app.request(`/research${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en',
      'x-fixture-user': userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const agentInput = { conversationId: 'document', message: 'Explain the input' };
async function seedSourceMessage(parts: Prisma.InputJsonValue = []) {
  await prisma.agentTurn.create({
    data: {
      id: 'source-turn',
      conversationId: 'document',
      model: 'fixture',
      status: 'done',
      trace: [],
    },
  });
  await prisma.agentMessage.create({
    data: {
      id: 'source-message',
      conversationId: 'document',
      turnId: 'source-turn',
      role: 'assistant',
      sequence: 0,
      parts,
    },
  });
}
async function seedClarification() {
  const clarification: ResearchClarificationV1 = {
    version: 1,
    id: 'clarification',
    documentId: 'document',
    title: 'Choose a measure',
    status: 'pending',
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'question',
        prompt: 'Which measure?',
        selectionMode: 'single',
        allowCustom: false,
        options: [
          {
            id: 'choice',
            kind: 'keep_gap',
            labelZh: '保留缺口',
            labelEn: 'Keep the gap',
            descriptionZh: '',
            descriptionEn: '',
          },
        ],
      },
    ],
  };
  await seedSourceMessage([
    { type: 'research_clarification', clarification },
  ] as unknown as Prisma.InputJsonValue);
  await prisma.researchClarification.create({
    data: {
      id: clarification.id,
      documentId: 'document',
      sourceTurnId: 'source-turn',
      sourceMessageId: 'source-message',
      sourcePartIndex: 0,
      title: clarification.title,
      questions: clarification.questions as unknown as Prisma.InputJsonValue,
    },
  });
}

describe('Research HTTP business boundaries', () => {
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
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/research.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    Object.values(resources).forEach((mock) => {
      mock.mockReset();
    });
    resources.id.mockImplementation(() => `fixture-${fixture.sequence++}`);
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid' },
        { id: 'other', email: 'other@fixture.invalid' },
      ],
    });
    await prisma.agentConversation.create({
      data: { id: 'document', userId: 'owner', surface: 'research', title: 'Fixture' },
    });
    await prisma.researchDocument.create({
      data: {
        id: 'document',
        conversationId: 'document',
        userId: 'owner',
        cells: {
          create: {
            id: 'input',
            position: 0,
            kind: 'python',
            source: 'value = 1',
            definitions: ['value'],
            references: [],
          },
        },
      },
    });
  });
  afterEach(async () => {
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('keeps Agent validation and ownership ahead of turn startup', async () => {
    expect(
      (
        await request('/agent', {
          message: 'Hello',
          attemptId: 'attempt',
          contextCellIds: ['input'],
        })
      ).status,
    ).toBe(400);
    expect(await prisma.agentConversation.count()).toBe(1);
    const response = await request('/agent', agentInput, 'other');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: t('en', 'conversationNotFound') },
    });
    await prisma.agentConversation.update({
      where: { id: 'document' },
      data: { archivedAt: new Date() },
    });
    expect((await request('/agent', agentInput)).status).toBe(404);
    expect(resources.enqueue).not.toHaveBeenCalled();
  });

  it('starts a new conversation and preserves the title limit and locale', async () => {
    const message = 'x'.repeat(80);
    const response = await request('/agent', { message });
    expect(response.status).toBe(200);
    const ids = await response.json();
    expect(
      await prisma.agentConversation.findUnique({ where: { id: ids.conversationId } }),
    ).toMatchObject({ userId: 'owner', surface: 'research', title: 'x'.repeat(60) });
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: ids.turnId,
        entity: { kind: 'research', id: ids.conversationId },
        locale: 'en',
        userParts: [{ type: 'text', text: message }],
      }),
    );
  });

  it('attaches deduplicated owned Cell snapshots and rejects a concurrent Agent turn', async () => {
    const response = await request('/agent', {
      ...agentInput,
      contextCellIds: ['input', 'input', 'missing'],
    });
    expect(response.status).toBe(200);
    const parts = resources.enqueue.mock.calls[0][0].userParts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      type: 'research_cell_context',
      snapshotVersion: 1,
      cells: [{ cellId: 'input', source: 'value = 1' }],
    });
    resources.running.mockReturnValue({ turnId: 'running' });
    const busy = await request('/agent', agentInput);
    expect(busy.status).toBe(400);
    expect(await busy.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: t('en', 'conversationTurnInProgress') },
    });
    expect(resources.enqueue).toHaveBeenCalledOnce();
  });

  it('requires a pending clarification to be answered and maps each answer failure', async () => {
    await seedClarification();
    const pending = await request('/agent', agentInput);
    expect(await pending.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: t('en', 'researchClarificationPending') },
    });
    const answer = {
      conversationId: 'document',
      clarificationAnswer: {
        clarificationId: 'clarification',
        selections: [{ questionId: 'question', selectedOptionIds: ['choice'] }],
      },
    };
    expect(
      (
        await request('/agent', {
          ...answer,
          clarificationAnswer: { ...answer.clarificationAnswer, clarificationId: 'missing' },
        })
      ).status,
    ).toBe(404);
    const invalid = await request('/agent', {
      ...answer,
      clarificationAnswer: {
        ...answer.clarificationAnswer,
        selections: [{ questionId: 'question', selectedOptionIds: ['missing'] }],
      },
    });
    expect(await invalid.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: t('en', 'researchClarificationInvalidAnswer') },
    });
    expect(resources.enqueue).not.toHaveBeenCalled();
    expect((await request('/agent', answer)).status).toBe(200);
    expect(resources.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        message: t('en', 'researchClarificationAnswerMessage', { selections: 'Keep the gap' }),
      }),
    );
    expect(
      await prisma.researchClarification.findUnique({ where: { id: 'clarification' } }),
    ).toMatchObject({ status: 'answered' });
    const repeated = await request('/agent', answer);
    expect(await repeated.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: t('en', 'researchClarificationAlreadyResolved'),
      },
    });
    expect(resources.enqueue).toHaveBeenCalledOnce();
  });

  it('links a finished attempt before enqueueing its explanation and rejects unfinished attempts', async () => {
    await seedSourceMessage();
    await prisma.researchCellChangeProposal.create({
      data: {
        id: 'proposal',
        documentId: 'document',
        sourceTurnId: 'source-turn',
        sourceMessageId: 'source-message',
        sourcePartIndex: 0,
        title: 'Fixture',
        summary: '',
        expectedDocumentUpdatedAt: new Date(),
        operations: [],
      },
    });
    await prisma.researchCellChangeAttempt.create({
      data: {
        id: 'attempt',
        documentId: 'document',
        proposalId: 'proposal',
        contentRevision: 1,
        scope: 'affected',
        rootCellIds: ['input'],
        plannedCellIds: ['input'],
      },
    });
    const body = { ...agentInput, attemptId: 'attempt' };
    expect((await request('/agent', body)).status).toBe(404);
    expect(resources.enqueue).not.toHaveBeenCalled();
    await prisma.researchCellChangeAttempt.update({
      where: { id: 'attempt' },
      data: { status: 'success', finishedAt: new Date() },
    });
    let linkedAtEnqueue: Promise<{ explanationTurnId: string | null }> | undefined;
    resources.enqueue.mockImplementation(() => {
      linkedAtEnqueue = prisma.researchCellChangeAttempt
        .findUniqueOrThrow({
          where: { id: 'attempt' },
          select: { explanationTurnId: true },
        })
        .then((attempt) => attempt);
    });
    const response = await request('/agent', body);
    expect(response.status).toBe(200);
    const { turnId } = await response.json();
    expect(await linkedAtEnqueue).toEqual({ explanationTurnId: turnId });
  });

  it('checks archive ownership before busy state and closes the session only when archived', async () => {
    const control = startResearchDocumentRun('document');
    try {
      expect((await request('/documents/document/archive', undefined, 'other')).status).toBe(404);
      expect((await request('/documents/document/archive')).status).toBe(400);
      expect(resources.close).not.toHaveBeenCalled();
    } finally {
      finishResearchDocumentRun(control);
    }
    resources.running.mockReturnValue({ turnId: 'running' });
    expect((await request('/documents/document/archive')).status).toBe(400);
    resources.running.mockReset();
    expect((await request('/documents/document/archive')).status).toBe(200);
    expect(resources.close).toHaveBeenCalledExactlyOnceWith('document');
    expect(await prisma.agentConversation.findUnique({ where: { id: 'document' } })).toMatchObject({
      archivedAt: expect.any(Date),
    });
  });

  it('keeps legacy conversation previews, archive filters, and owner-scoped rename/delete', async () => {
    await seedSourceMessage([{ type: 'universe', title: 'Universe preview' }]);
    expect(await (await request('/conversations', undefined, 'owner', 'GET')).json()).toMatchObject(
      [{ id: 'document', preview: 'Universe preview' }],
    );
    expect(await (await request('/conversations', undefined, 'other', 'GET')).json()).toEqual([]);
    expect(
      (await request('/conversations/document', { title: 'Changed' }, 'other', 'PATCH')).status,
    ).toBe(404);
    expect(
      (await request('/conversations/document', { title: 'Changed' }, 'owner', 'PATCH')).status,
    ).toBe(200);
    await prisma.agentConversation.update({
      where: { id: 'document' },
      data: { archivedAt: new Date() },
    });
    expect(await (await request('/conversations', undefined, 'owner', 'GET')).json()).toEqual([]);
    expect(
      (await request('/conversations/document', { title: 'No change' }, 'owner', 'PATCH')).status,
    ).toBe(404);
    expect((await request('/conversations/document', undefined, 'other', 'DELETE')).status).toBe(
      404,
    );
    expect(resources.close).not.toHaveBeenCalled();
    expect((await request('/conversations/document', undefined, 'owner', 'DELETE')).status).toBe(
      200,
    );
    expect(resources.close).toHaveBeenCalledExactlyOnceWith('document');
  });

  it('rechecks artifact ownership before a conditional cache response', async () => {
    await prisma.researchCellExecution.create({
      data: {
        id: 'execution',
        documentId: 'document',
        revision: 1,
        source: '',
        status: 'success',
        definitions: [],
        references: [],
        environmentFingerprint: 'fixture',
      },
    });
    await prisma.researchArtifact.create({
      data: {
        id: 'artifact',
        documentId: 'document',
        executionId: 'execution',
        kind: 'image',
        mimeType: 'image/png',
        data: Buffer.from('image'),
        byteSize: 5,
        sha256: 'fixture-sha',
      },
    });
    const first = await request('/artifacts/artifact', undefined, 'owner', 'GET');
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('image');
    expect(first.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const headers = { 'if-none-match': '"fixture-sha"' };
    expect((await app.request('/research/artifacts/artifact', { headers })).status).toBe(304);
    expect(
      (
        await app.request('/research/artifacts/artifact', {
          headers: { ...headers, 'x-fixture-user': 'other' },
        })
      ).status,
    ).toBe(404);
  });

  it('submits a durable Curator job from the last successful cursor and reuses an active run', async () => {
    const cursor = new Date('2026-09-01T00:00:00Z');
    await prisma.researchCuratorRun.createMany({
      data: [
        { id: 'previous', userId: 'owner', cursorTo: cursor, status: 'done' },
        {
          id: 'failed',
          userId: 'owner',
          cursorTo: new Date('2026-09-02T00:00:00Z'),
          status: 'error',
        },
        { id: 'foreign', userId: 'other', cursorTo: new Date(), status: 'running' },
      ],
    });
    const response = await request('/curator/runs');
    expect(response.status).toBe(200);
    const run = await response.json();
    expect(await prisma.researchCuratorRun.findUnique({ where: { id: run.id } })).toMatchObject({
      userId: 'owner',
      cursorFrom: cursor,
      status: 'queued',
    });
    const job = await prisma.job.findFirstOrThrow({ where: { researchCuratorRunId: run.id } });
    expect(job).toMatchObject({
      userId: 'owner',
      status: 'queued',
      kind: 'research-curator',
      payload: { runId: run.id },
    });
    expect(resources.logs).toHaveBeenCalledExactlyOnceWith(job.id);
    expect(resources.wake).toHaveBeenCalledOnce();
    expect(await (await request('/curator/runs')).json()).toMatchObject({ id: run.id });
    expect(await prisma.job.count()).toBe(1);
    expect(resources.wake).toHaveBeenCalledOnce();
  });

  it('rolls back the Curator run when its job cannot be inserted and does not wake the queue', async () => {
    await prisma.job.create({
      data: {
        id: 'existing-job',
        userId: 'owner',
        kind: 'research-curator',
        key: 'default',
        status: 'queued',
        payload: {},
      },
    });
    resources.id.mockReturnValueOnce('new-run').mockReturnValueOnce('existing-job');
    await expect(submitResearchCuratorRun('owner')).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.researchCuratorRun.count()).toBe(0);
    expect(resources.logs).not.toHaveBeenCalled();
    expect(resources.wake).not.toHaveBeenCalled();
  });
});
