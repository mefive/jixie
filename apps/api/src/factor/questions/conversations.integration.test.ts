import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLlm, AgentLlmReply } from '#infra/llm/agent-llm.js';
import type { FactorQuestionHistoryV1, FactorQuestionTurnV1 } from '@jixie/shared';

const fixture = vi.hoisted(() => ({ directory: '', llm: vi.fn<AgentLlm>() }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-factor-questions-');
  writeFileSync(`${fixture.directory}/test.db`, '');
  return {
    prisma: new exports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/test.db` }),
  };
});
vi.mock('#infra/llm/deepseek.js', () => ({ chatTools: fixture.llm }));

import { prisma } from '#infra/database/prisma.js';
import { agentRoute } from '#agent/routes.js';
import * as turnBus from '#agent/turns/bus.js';
import { markRunningAgentTurnsInterrupted } from '#agent/turns/records.js';
import { factorRoute } from '../routes.js';
import { startFactorQuestion } from './conversations.js';

const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-user') ?? 'owner');
  await next();
});
app.route('/factors', factorRoute);
app.route('/agent', agentRoute);
function request(path: string, body?: unknown, user = 'owner', locale = 'en') {
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': locale, 'x-user': user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function submit(reportId?: string, factorKey = 'factor', user = 'owner') {
  const response = await request(
    '/factors/questions',
    { factorKey, message: 'Explain this result.', reportId },
    user,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<FactorQuestionTurnV1>;
}
async function history(key = 'factor', query = '', user = 'owner') {
  const response = await request(`/factors/${key}/questions${query}`, undefined, user);
  expect(response.status).toBe(200);
  return response.json() as Promise<FactorQuestionHistoryV1>;
}
async function finished(turnId: string) {
  await vi.waitFor(async () => {
    expect((await prisma.agentTurn.findUniqueOrThrow({ where: { id: turnId } })).status).not.toBe(
      'running',
    );
  });
}
function pauseAnswer() {
  let release!: (reply: AgentLlmReply) => void;
  fixture.llm.mockImplementationOnce(
    (_messages, _tools, options) =>
      new Promise((resolveReply, rejectReply) => {
        release = resolveReply;
        options?.signal?.addEventListener('abort', () => rejectReply(new Error('Cancelled')), {
          once: true,
        });
      }),
  );
  return async () => {
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release({ text: 'Fixture answer.' });
  };
}

describe('private durable Factor questions', () => {
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
      {
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/test.db` },
        stdio: 'pipe',
      },
    );
  }, 60_000);
  beforeEach(async () => {
    fixture.llm.mockReset().mockResolvedValue({ text: 'Fixture answer.' });
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'owner@fixture.invalid' },
        { id: 'other', email: 'other@fixture.invalid' },
        { id: 'builtin', email: 'builtin@fixture.invalid' },
      ],
    });
    await prisma.factor.createMany({
      data: [
        {
          id: 'factor',
          userId: 'owner',
          name: 'Same name',
          code: 'saved source',
          key: 'factor',
          status: 'published',
          visibility: 'public',
          messages: [{ role: 'user', content: 'Authoring history' }],
        },
        {
          id: 'private',
          userId: 'other',
          name: 'Same name',
          code: 'private source',
          key: 'private',
        },
        { id: 'preset', userId: 'builtin', name: 'Preset', code: 'preset source', key: 'preset' },
      ],
    });
    await prisma.factorReport.createMany({
      data: [
        {
          id: 'report-a',
          userId: 'owner',
          factor: 'factor',
          phase: 'explore',
          status: 'done',
          freq: 'month',
          start: '20200101',
          end: '20231231',
          payload: '{"icMean":0.12}',
          factorCodeSnapshot: 'report source',
        },
        {
          id: 'report-b',
          userId: 'owner',
          factor: 'factor',
          phase: 'explore',
          status: 'done',
          freq: 'month',
          start: '20240101',
          end: '20251231',
          payload: '{"icMean":0.03}',
        },
        {
          id: 'sealed',
          userId: 'owner',
          factor: 'factor',
          phase: 'holdout',
          status: 'done',
          freq: 'month',
          start: '20240101',
          end: '20251231',
          payload: '{"icMean":0.99}',
        },
        {
          id: 'foreign',
          userId: 'other',
          factor: 'factor',
          status: 'done',
          freq: 'month',
          start: '20200101',
          end: '20231231',
          payload: '{"icMean":0.88}',
        },
      ],
    });
  });
  afterEach(async () => {
    for (const turn of await prisma.agentTurn.findMany({
      where: { status: 'running' },
      select: { id: true },
    })) {
      turnBus.cancel(turn.id, 'owner');
    }
    await vi.waitFor(async () =>
      expect(await prisma.agentTurn.count({ where: { status: 'running' } })).toBe(0),
    );
    turnBus._resetForTest();
    // Factor sources and reports use plain owner IDs, so deleting a User does not remove them.
    await prisma.factorReport.deleteMany();
    await prisma.factorComposite.deleteMany();
    await prisma.factor.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('persists input and context before replying to HTTP and restores the live turn', async () => {
    const release = pauseAnswer();
    const submitted = await submit('report-a');
    const restored = await history();
    expect(restored).toMatchObject({
      conversationId: submitted.conversationId,
      activeTurnId: submitted.turnId,
      messages: [
        {
          role: 'user',
          turnStatus: 'running',
          contextSnapshot: {
            factor: { key: 'factor', source: 'saved source' },
            report: { id: 'report-a', summary: { metrics: { rankIc: 0.12 } } },
          },
        },
      ],
    });
    const active = await request(
      `/agent/turns/active?entity=factor-question:${submitted.conversationId}`,
    );
    expect(await active.json()).toEqual({ turnId: submitted.turnId });
    await release();
    await finished(submitted.turnId);
    expect((await history()).messages).toHaveLength(2);
    expect((await request(`/agent/turns/${submitted.turnId}`)).status).toBe(200);
  });

  it('keeps one conversation but pins each question to its own report and source', async () => {
    const first = await submit('report-a');
    await finished(first.turnId);
    const original = (await history()).messages[0].contextSnapshot;
    await prisma.factor.update({ where: { id: 'factor' }, data: { code: 'new saved source' } });
    const second = await submit('report-b');
    await finished(second.turnId);
    expect(second.conversationId).toBe(first.conversationId);
    const messages = (await history()).messages;
    expect(messages[0].contextSnapshot).toEqual(original);
    expect(messages[2].contextSnapshot).toMatchObject({
      factor: { source: 'new saved source' },
      report: { id: 'report-b' },
    });
    const system = fixture.llm.mock.calls.at(-1)![0][0].content;
    expect(system).toContain('report-b');
    expect(system).toContain('0.03');
    expect(system).not.toContain('report-a');
    expect(
      fixture.llm.mock.calls
        .at(-1)![0]
        .some((message) => message.content?.includes('report=report-a')),
    ).toBe(true);
  });

  it('does not change published definitions or expose private histories to another user', async () => {
    const original = await prisma.factor.findUniqueOrThrow({ where: { id: 'factor' } });
    const first = await submit();
    await finished(first.turnId);
    expect(await prisma.factor.findUniqueOrThrow({ where: { id: 'factor' } })).toEqual(original);
    expect((await history('factor', '', 'other')).messages).toEqual([]);
    expect((await request(`/agent/turns/${first.turnId}`, undefined, 'other')).status).toBe(404);
    expect(
      (await request(`/agent/conversations/${first.conversationId}/messages`, undefined, 'other'))
        .status,
    ).toBe(404);
    const second = await submit(undefined, 'factor', 'other');
    await finished(second.turnId);
    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it('rejects wrong, foreign, unfinished and sealed reports before saving any question', async () => {
    await prisma.factorReport.create({
      data: {
        id: 'wrong',
        userId: 'owner',
        factor: 'preset',
        status: 'done',
        freq: 'month',
        start: '20200101',
        end: '20231231',
        payload: '{}',
      },
    });
    await prisma.factorReport.create({
      data: {
        id: 'pending',
        userId: 'owner',
        factor: 'factor',
        status: 'running',
        freq: 'month',
        start: '20200101',
        end: '20231231',
      },
    });
    for (const reportId of ['wrong', 'foreign', 'pending', 'sealed']) {
      expect(
        (await request('/factors/questions', { factorKey: 'factor', reportId, message: 'Explain' }))
          .status,
      ).toBe(400);
    }
    expect(await prisma.agentConversation.count()).toBe(0);
    expect(await prisma.agentMessage.count()).toBe(0);
    expect(fixture.llm).not.toHaveBeenCalled();
    await prisma.factorReport.update({ where: { id: 'sealed' }, data: { revealedAt: new Date() } });
    const accepted = await submit('sealed');
    await finished(accepted.turnId);
  });

  it('supports seeded presets, code templates and composites with stable identities', async () => {
    await prisma.factorComposite.create({
      data: {
        id: 'composite',
        userId: 'owner',
        name: 'Composite',
        definition: { version: 1, components: [] },
      },
    });
    for (const key of ['preset', 'etf_trend_20', 'composite']) {
      const submitted = await submit(undefined, key);
      await finished(submitted.turnId);
      expect(submitted.message.contextSnapshot?.factor.key).toBe(key);
      expect(submitted.message.contextSnapshot?.report).toBeNull();
    }
    expect(
      (await request('/factors/questions', { factorKey: 'private', message: 'Explain' })).status,
    ).toBe(404);
  });

  it('retains private snapshots after a source or report is deleted', async () => {
    const submitted = await submit('report-a');
    await finished(submitted.turnId);
    const original = await history();
    await prisma.factorReport.delete({ where: { id: 'report-a' } });
    await prisma.factor.delete({ where: { id: 'factor' } });
    expect(await history()).toEqual(original);
    expect(
      (await request('/factors/questions', { factorKey: 'factor', message: 'Again' })).status,
    ).toBe(404);
  });

  it('allows only one active question for a user and factor, including simultaneous requests', async () => {
    const release = pauseAnswer();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        startFactorQuestion('owner', { factorKey: 'factor', message: 'Concurrent' }, 'en'),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.agentConversation.count()).toBe(1);
    expect(await prisma.agentTurn.count()).toBe(1);
    await release();
    await finished(
      (
        results.find(
          (result) => result.status === 'fulfilled',
        ) as PromiseFulfilledResult<FactorQuestionTurnV1>
      ).value.turnId,
    );
  });

  it('retains cancellation and provider failures without fabricating successful assistant messages', async () => {
    pauseAnswer();
    const cancelled = await submit();
    await vi.waitFor(() => expect(fixture.llm).toHaveBeenCalled());
    await request(`/agent/turns/${cancelled.turnId}/cancel`, {});
    await finished(cancelled.turnId);
    expect((await history()).messages).toMatchObject([{ role: 'user', turnStatus: 'cancelled' }]);
    fixture.llm.mockRejectedValueOnce(new Error('Fixture provider unavailable'));
    const failed = await submit();
    await finished(failed.turnId);
    expect((await history()).messages).toMatchObject([
      { turnStatus: 'cancelled' },
      { turnStatus: 'error', turnError: 'Fixture provider unavailable' },
    ]);
    const retried = await submit();
    await finished(retried.turnId);
    expect((await history()).messages).toHaveLength(4);
  });

  it('recovers interrupted persisted questions and allows a subsequent attempt', async () => {
    const conversation = await prisma.agentConversation.create({
      data: {
        id: 'interrupted-conversation',
        userId: 'owner',
        surface: 'factor-question',
        questionFactorKey: 'factor',
      },
    });
    await prisma.agentTurn.create({
      data: {
        id: 'interrupted',
        conversationId: conversation.id,
        status: 'running',
        model: 'fixture',
        trace: { version: 1, steps: [], truncated: false },
      },
    });
    expect(await markRunningAgentTurnsInterrupted()).toBe(1);
    expect((await history()).activeTurnId).toBeNull();
    const submitted = await submit();
    await finished(submitted.turnId);
  });

  it('paginates older messages without losing report context or merging names', async () => {
    for (let index = 0; index < 3; index += 1) {
      const result = await submit('report-a');
      await finished(result.turnId);
    }
    const latest = await history('factor', '?limit=2');
    expect(latest.messages.map((message) => message.sequence)).toEqual([4, 5]);
    const earlier = await history('factor', `?limit=2&before=${latest.nextBefore}`);
    expect(earlier.messages.map((message) => message.sequence)).toEqual([2, 3]);
    expect(earlier.messages[0].contextSnapshot?.report?.id).toBe('report-a');
  });

  it('requires a stable identity, rejects client history, and explains the upgrade in both languages', async () => {
    for (const locale of ['zh', 'en']) {
      const response = await request(
        '/factors/questions',
        { factorName: 'Same name', history: [], message: 'Explain' },
        'owner',
        locale,
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain(locale === 'zh' ? '刷新' : 'Refresh');
    }
    expect(
      (
        await request('/factors/questions', {
          factorKey: 'factor',
          message: 'Explain',
          history: [],
        })
      ).status,
    ).toBe(400);
    expect(await prisma.agentTurn.count()).toBe(0);
  });

  it('rejects oversized context without truncating the source or saving a partial turn', async () => {
    await prisma.factor.update({ where: { id: 'factor' }, data: { code: 'x'.repeat(66 * 1024) } });
    const response = await request('/factors/questions', {
      factorKey: 'factor',
      message: 'Explain',
    });
    expect(response.status).toBe(400);
    expect(await prisma.agentConversation.count()).toBe(0);
    expect(await prisma.agentTurn.count()).toBe(0);
    expect(fixture.llm).not.toHaveBeenCalled();
  });
});
