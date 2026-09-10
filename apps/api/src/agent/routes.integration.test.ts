import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import type { AgentStreamEvent, AgentTurnTrace } from '@jixie/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLlm } from '#infra/llm/agent-llm.js';

const fixture = vi.hoisted(() => ({ directory: '' }));
const resources = vi.hoisted(() => ({ llm: vi.fn<AgentLlm>(), sql: vi.fn(), compute: vi.fn() }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-agent-http-');
  const database = `${fixture.directory}/agent.db`;
  writeFileSync(database, '');
  return { prisma: new exports.PrismaClient({ datasourceUrl: `file:${database}` }) };
});
vi.mock('#infra/llm/deepseek.js', () => ({ chatTools: resources.llm }));
vi.mock('./tools/sql/read-only-sql.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tools/sql/read-only-sql.js')>()),
  runReadOnlySql: resources.sql,
}));
vi.mock('./tools/charts/render-computed-chart.js', () => ({
  runComputeChartRows: resources.compute,
}));

import { prisma } from '#infra/database/prisma.js';
import { agentRoute } from './routes.js';
import * as turnBus from './turns/bus.js';
import { enqueueAgentTurn } from './turns/run.js';
import {
  finishPersistentTurn,
  markRunningAgentTurnsInterrupted,
  startPersistentTurn,
} from './turns/records.js';

const trace: AgentTurnTrace = { version: 1, steps: [], truncated: false };
const app = new Hono();
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-fixture-user') ?? 'owner');
  await next();
});
app.route('/agent', agentRoute);
function request(
  path: string,
  userId = 'owner',
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) {
  return app.request(`/agent${path}`, {
    method,
    headers: {
      'x-fixture-user': userId,
      'accept-language': 'en',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function waitForTurn(turnId: string) {
  const events: AgentStreamEvent[] = [];
  const subscription = turnBus.subscribe(turnId, 'owner', (event) => events.push(event));
  if (subscription.kind !== 'live') {
    throw new Error(`Expected live turn, got ${subscription.kind}`);
  }
  return subscription.closed.then(() => events);
}
function enqueue(turnId: string, afterTurn?: Parameters<typeof enqueueAgentTurn>[0]['afterTurn']) {
  enqueueAgentTurn({
    turnId,
    userId: 'owner',
    entity: { kind: 'strategy', id: 'strategy' },
    profile: { system: 'Answer the fixture question.' },
    message: 'Explain.',
    currentCode: '',
    locale: 'en',
    afterTurn,
  });
  return waitForTurn(turnId);
}
async function createTurn(turnId: string) {
  return startPersistentTurn({
    turnId,
    userId: 'owner',
    entity: { kind: 'strategy', id: 'strategy' },
    history: [],
    message: 'Explain.',
    model: 'fixture',
  });
}
function parseEvents(text: string): AgentStreamEvent[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

describe('Agent HTTP and durable turn boundaries', () => {
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
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/agent.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    resources.llm.mockReset().mockResolvedValue({ text: 'Fixture answer.' });
    resources.sql.mockReset();
    resources.compute.mockReset();
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'agent-owner@fixture.invalid' },
        { id: 'other', email: 'agent-other@fixture.invalid' },
      ],
    });
    await prisma.strategy.create({
      data: { id: 'strategy', userId: 'owner', name: 'Fixture', config: {}, messages: [] },
    });
  });
  afterEach(async () => {
    turnBus._resetForTest();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it('filters conversations by ownership and surface and preserves message pagination and parts', async () => {
    const { conversationId } = await createTurn('turn');
    await finishPersistentTurn({
      turnId: 'turn',
      status: 'done',
      parts: [{ type: 'text', text: 'Answer.' }],
      trace,
    });
    await prisma.agentConversation.createMany({
      data: [
        { id: 'archived', userId: 'owner', surface: 'research', archivedAt: new Date() },
        { id: 'foreign', userId: 'other', surface: 'strategy' },
        { id: 'research', userId: 'owner', surface: 'research' },
      ],
    });
    const conversations = await (
      await request('/conversations?surface=strategy&entityId=strategy')
    ).json();
    expect(conversations.map((row: { id: string }) => row.id)).toEqual([conversationId]);
    expect(
      (await (await request('/conversations')).json()).map((row: { id: string }) => row.id).sort(),
    ).toEqual([conversationId, 'research'].sort());
    const recent = await (
      await request(`/conversations/${conversationId}/messages?limit=1`)
    ).json();
    expect(recent).toMatchObject({
      nextBefore: 1,
      messages: [
        {
          role: 'assistant',
          sequence: 1,
          turnId: 'turn',
          parts: [{ type: 'text', text: 'Answer.' }],
        },
      ],
    });
    const previous = await (
      await request(`/conversations/${conversationId}/messages?before=${recent.nextBefore}&limit=1`)
    ).json();
    expect(previous).toMatchObject({ nextBefore: 0, messages: [{ role: 'user', sequence: 0 }] });
    expect(
      await (await request(`/conversations/${conversationId}/messages?before=0`)).json(),
    ).toEqual({ messages: [] });
    expect((await request(`/conversations/${conversationId}/messages`, 'other')).status).toBe(404);
    expect((await request('/turns/turn/detail', 'other')).status).toBe(404);
    expect(await (await request('/turns/turn/detail')).json()).toMatchObject({
      id: 'turn',
      status: 'done',
      trace,
    });
    expect((await request(`/conversations/${conversationId}/messages?limit=101`)).status).toBe(400);
  });

  it('replays SSE snapshots and terminal events and protects stream and cancellation ownership', async () => {
    const { signal } = turnBus.start('live', 'owner', 'strategy:strategy');
    turnBus.publish('live', { type: 'delta', text: 'partial' });
    expect(await (await request('/turns/running?entity=strategy:strategy')).json()).toEqual({
      turnId: 'live',
    });
    expect(
      await (await request('/turns/running?entity=strategy:strategy', 'other')).json(),
    ).toEqual({ turnId: null });
    expect(await (await request('/turns/live/cancel', 'other', {})).json()).toEqual({
      ok: true,
      cancelled: false,
    });
    expect(signal.aborted).toBe(false);
    expect(parseEvents(await (await request('/turns/live/stream', 'other')).text())).toMatchObject([
      { type: 'error' },
    ]);
    expect(await (await request('/turns/live/cancel', 'owner', {})).json()).toEqual({
      ok: true,
      cancelled: true,
    });
    expect(signal.aborted).toBe(true);
    turnBus.finish('live', { type: 'cancelled' });
    const response = await request('/turns/live/stream');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(parseEvents(await response.text())).toEqual([
      { type: 'snapshot', text: 'partial', trace: [] },
      { type: 'cancelled' },
    ]);
    expect(await (await request('/turns/live/cancel', 'owner', {})).json()).toEqual({
      ok: true,
      cancelled: false,
    });
    expect(parseEvents(await (await request('/turns/missing/stream')).text())).toMatchObject([
      { type: 'error' },
    ]);
    expect((await request('/turns/live/stream', 'owner', {})).status).toBe(400);
  });

  it('persists both messages before done and invokes the after-turn hook after publication', async () => {
    resources.llm.mockImplementation(async (_messages, _tools, options) => {
      expect(await prisma.agentMessage.findMany()).toMatchObject([{ role: 'user', sequence: 0 }]);
      expect(
        (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).messages,
      ).toMatchObject([{ role: 'user' }]);
      options?.onDelta?.('Fixture answer.');
      return { text: 'Fixture answer.' };
    });
    const afterTurn = vi.fn(async () => {
      expect(turnBus.findRunning('strategy:strategy', 'owner')).toBeNull();
      expect(await prisma.agentMessage.count()).toBe(2);
    });
    const events = await enqueue('success', afterTurn);
    expect(events.map((event) => event.type)).toContain('delta');
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      parts: [{ type: 'text', text: 'Fixture answer.' }],
    });
    expect(await prisma.agentMessage.findMany({ orderBy: { sequence: 'asc' } })).toMatchObject([
      { role: 'user', sequence: 0 },
      { role: 'assistant', sequence: 1 },
    ]);
    expect(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } })).messages,
    ).toMatchObject([{ role: 'user' }, { role: 'assistant' }]);
    expect(await prisma.agentTurn.findUniqueOrThrow({ where: { id: 'success' } })).toMatchObject({
      status: 'done',
      trace: { steps: [{ type: 'model', status: 'success' }] },
    });
    expect(afterTurn).toHaveBeenCalledOnce();
    await afterTurn.mock.results[0].value;
  });

  it('cancels a running model call without persisting an assistant reply', async () => {
    let modelEntered: () => void = () => {};
    const entered = new Promise<void>((resolveEntered) => {
      modelEntered = resolveEntered;
    });
    resources.llm.mockImplementation(async (_messages, _tools, options) => {
      modelEntered();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('Fixture cancellation'));
        if (options?.signal?.aborted) {
          abort();
        } else {
          options?.signal?.addEventListener('abort', abort, { once: true });
        }
      });
    });
    const finished = enqueue('cancelled');
    await entered;
    expect(await (await request('/turns/cancelled/cancel', 'owner', {})).json()).toEqual({
      ok: true,
      cancelled: true,
    });
    expect((await finished).at(-1)).toEqual({ type: 'cancelled' });
    expect(await prisma.agentMessage.findMany()).toMatchObject([{ role: 'user' }]);
    expect(await prisma.agentMessage.count()).toBe(1);
    expect(await prisma.agentTurn.findUniqueOrThrow({ where: { id: 'cancelled' } })).toMatchObject({
      status: 'cancelled',
      error: null,
    });
  });

  it('persists failed turns and recovers only interrupted running records', async () => {
    resources.llm.mockRejectedValue(new Error('Fixture model failure'));
    expect((await enqueue('failed')).at(-1)).toEqual({
      type: 'error',
      message: 'Fixture model failure',
    });
    expect(await prisma.agentMessage.count()).toBe(1);
    await createTurn('interrupted');
    expect(await markRunningAgentTurnsInterrupted()).toBe(1);
    expect(await markRunningAgentTurnsInterrupted()).toBe(0);
    expect(await prisma.agentTurn.findUniqueOrThrow({ where: { id: 'failed' } })).toMatchObject({
      status: 'error',
      error: 'Fixture model failure',
    });
    expect(
      await prisma.agentTurn.findUniqueOrThrow({ where: { id: 'interrupted' } }),
    ).toMatchObject({ status: 'interrupted', error: 'API process restarted' });
  });

  it('rolls back a reply and turn completion when a Research artifact targets a Strategy conversation', async () => {
    await createTurn('invalid');
    await expect(
      finishPersistentTurn({
        turnId: 'invalid',
        status: 'done',
        trace,
        parts: [
          {
            type: 'research_clarification',
            clarification: {
              version: 1,
              id: 'clarification',
              documentId: 'document',
              title: 'Fixture',
              status: 'pending',
              questions: [],
              createdAt: new Date().toISOString(),
            },
          },
        ],
      }),
    ).rejects.toThrow('Research artifacts require a Research conversation.');
    expect(await prisma.agentMessage.count()).toBe(1);
    expect(await prisma.agentTurn.findUniqueOrThrow({ where: { id: 'invalid' } })).toMatchObject({
      status: 'running',
      finishedAt: null,
    });
    expect(await prisma.researchClarification.count()).toBe(0);
  });

  it('keeps SQL and computed-chart wire conversion and error mapping', async () => {
    resources.sql.mockResolvedValue([{ count: 2n }]);
    expect(
      await (await request('/sql', 'owner', { sql: 'SELECT count(*) AS count FROM Daily' })).json(),
    ).toEqual({ rows: [{ count: 2 }] });
    expect(resources.sql).toHaveBeenCalledWith('SELECT count(*) AS count FROM Daily', 500);
    resources.sql.mockRejectedValue(new Error('Fixture SQL rejection'));
    expect((await request('/sql', 'owner', { sql: 'SELECT * FROM User' })).status).toBe(400);
    const spec = {
      source: 'compute',
      kind: 'line',
      queries: [{ name: 'daily', sql: 'SELECT close FROM Daily' }],
      code: 'export default ({data}) => data.daily;',
      x: 'date',
      series: [{ column: 'close' }],
    };
    resources.compute.mockResolvedValue([{ date: '20240102', close: 10n }]);
    expect(await (await request('/chart/compute', 'owner', spec)).json()).toEqual({
      rows: [{ date: '20240102', close: 10 }],
    });
    expect(resources.compute).toHaveBeenCalledWith(spec);
    resources.compute.mockRejectedValue(new Error('Fixture chart rejection'));
    expect((await request('/chart/compute', 'owner', spec)).status).toBe(400);
  });
});
