import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AgentLlm } from '#infra/llm/agent-llm.js';
import {
  normalizeChatMessage,
  type AgentStreamEvent,
  type CodeChangeProposalV1,
} from '@jixie/shared';

const fixture = vi.hoisted(() => ({ directory: '' }));
const model = vi.hoisted(() => ({ llm: vi.fn<AgentLlm>() }));
vi.mock('#infra/database/prisma.js', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { default: exports } = await import('@prisma/client');
  fixture.directory = mkdtempSync('/tmp/jixie-code-proposals-');
  writeFileSync(`${fixture.directory}/review.db`, '');

  return {
    prisma: new exports.PrismaClient({ datasourceUrl: `file:${fixture.directory}/review.db` }),
  };
});
vi.mock('#infra/llm/deepseek.js', () => ({ chatTools: model.llm, chatJson: vi.fn() }));

import { prisma } from '#infra/database/prisma.js';
import { handleApiError } from '#infra/http/errors.js';
import { factorAgentRoute } from '#factor/routes/agent.js';
import { strategyAgentRoute } from '#strategy/routes/agent.js';
import { factorCodeIdentity } from '#factor/agent/code-proposals.js';
import { strategyCodeIdentity } from '#strategy/agent/code-proposals.js';
import { hydrateCodeProposals, readCodeProposalHistory } from './conversations/code-proposals.js';
import { enqueueAgentTurn } from './turns/run.js';
import * as turnBus from './turns/bus.js';

const app = new Hono().onError(handleApiError);
app.use('*', async (context, next) => {
  context.set('userId', context.req.header('x-user') ?? 'owner');
  await next();
});
app.route('/factors', factorAgentRoute);
app.route('/strategies', strategyAgentRoute);
const beforeCode = 'const baseline = 1;';
const afterCode = 'const candidate = 2;';
type Surface = CodeChangeProposalV1['surface'];

async function generate(surface: Surface) {
  const host =
    surface === 'factor'
      ? await prisma.factor.findUniqueOrThrow({ where: { id: 'factor' } })
      : await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } });
  const baseIdentity =
    surface === 'factor'
      ? factorCodeIdentity(host as Awaited<ReturnType<typeof prisma.factor.findUniqueOrThrow>>)
      : strategyCodeIdentity((host as { config: unknown }).config);
  const validate = vi.fn().mockResolvedValue(undefined);
  enqueueAgentTurn({
    turnId: `turn-${surface}`,
    userId: 'owner',
    entity: { kind: surface, id: surface },
    profile: { system: 'Propose a code change.', artifact: { noun: surface, validate } },
    message: 'Update the source.',
    currentCode: beforeCode,
    codeProposal: { surface, entityId: surface, language: 'typescript', beforeCode, baseIdentity },
  });
  const events: AgentStreamEvent[] = [];
  const subscription = turnBus.subscribe(`turn-${surface}`, 'owner', (event) => events.push(event));
  if (subscription.kind !== 'live') {
    throw new Error(`Expected live subscription, got ${subscription.kind}`);
  }
  await subscription.closed;
  expect(validate).toHaveBeenCalledWith(afterCode);
  const done = events.find((event) => event.type === 'done');
  if (done?.type !== 'done') {
    throw new Error(JSON.stringify(events));
  }
  expect(done.code).toBe(beforeCode);
  expect(done.changed).toBe(false);
  const part = done.parts.find((part) => part.type === 'code_change');
  if (part?.type !== 'code_change') {
    throw new Error('Missing durable proposal in completion event');
  }

  return part.proposal;
}

function request(
  surface: Surface,
  proposalId: string,
  options: {
    userId?: string;
    entityId?: string;
    before?: string;
    read?: boolean;
  } = {},
) {
  return app.request(
    `/${surface === 'factor' ? 'factors' : 'strategies'}/${options.entityId ?? surface}/code-change-proposals/${proposalId}${options.read ? '' : '/accept'}`,
    {
      method: options.read ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en',
        'x-user': options.userId ?? 'owner',
      },
      ...(options.read
        ? {}
        : { body: JSON.stringify({ beforeCode: options.before ?? beforeCode }) }),
    },
  );
}

async function currentCode(surface: Surface) {
  if (surface === 'factor') {
    return (await prisma.factor.findUniqueOrThrow({ where: { id: surface } })).code;
  }
  const strategy = await prisma.strategy.findUniqueOrThrow({ where: { id: surface } });

  return (strategy.config as { code: string }).code;
}

describe('Durable code suggestions and explicit acceptance', () => {
  it('drops malformed proposal JSON before history or UI consumption', () => {
    const message = normalizeChatMessage({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Explanation' },
        { type: 'code_change' },
        { type: 'code_change', proposal: { version: 1, id: 'incomplete' } },
      ],
    });
    expect(message.parts).toEqual([{ type: 'text', text: 'Explanation' }]);
  });

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
        env: { ...process.env, DATABASE_URL: `file:${fixture.directory}/review.db` },
        stdio: 'pipe',
      },
    );
  }, 30_000);
  beforeEach(async () => {
    model.llm
      .mockReset()
      .mockResolvedValue({ text: `Proposed change.\n\`\`\`ts\n${afterCode}\n\`\`\`` });
    await prisma.user.createMany({
      data: [
        { id: 'owner', email: 'code-owner@fixture.invalid' },
        { id: 'other', email: 'code-other@fixture.invalid' },
      ],
    });
    await prisma.factor.create({
      data: {
        id: 'factor',
        userId: 'owner',
        key: 'candidate',
        name: 'Candidate',
        code: beforeCode,
        language: 'typescript',
        runtimeVersion: 'ts-v1',
        analysisKind: 'cross_sectional',
      },
    });
    await prisma.strategy.create({
      data: {
        id: 'strategy',
        userId: 'owner',
        name: 'Strategy',
        config: {
          code: beforeCode,
          language: 'typescript',
          runtimeVersion: 'ts-v1',
          initialCash: 100000,
        },
        messages: [],
      },
    });
  });
  afterEach(async () => {
    turnBus._resetForTest();
    await prisma.user.deleteMany();
    await prisma.factor.deleteMany();
    await prisma.strategy.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  });

  it.each<Surface>(['factor', 'strategy'])(
    'persists %s suggestions before done and updates code only on acceptance',
    async (surface) => {
      const proposal = await generate(surface);
      expect(await currentCode(surface)).toBe(beforeCode);
      const recovered = await readCodeProposalHistory(prisma, 'owner', surface, surface, []);
      expect(
        recovered.some((message) =>
          message.parts.some(
            (part) => part.type === 'code_change' && part.proposal.id === proposal.id,
          ),
        ),
      ).toBe(true);
      expect(
        await prisma.agentCodeChangeProposal.findUnique({ where: { id: proposal.id } }),
      ).toMatchObject({ status: 'pending', afterCode });
      const beforeMessages = await prisma.agentMessage.count();
      const loaded = await request(surface, proposal.id, { read: true });
      expect(loaded.status).toBe(200);
      expect(await loaded.json()).toMatchObject({ id: proposal.id, status: 'pending', beforeCode });
      expect(await currentCode(surface)).toBe(beforeCode);

      const response = await request(surface, proposal.id);
      expect(response.status).toBe(200);
      const accepted = await response.json();
      expect(accepted).toMatchObject({ status: 'accepted', afterCode });
      expect(await currentCode(surface)).toBe(afterCode);
      expect(await prisma.agentMessage.count()).toBe(beforeMessages);
      const retry = await request(surface, proposal.id);
      expect(await retry.json()).toEqual(accepted);
      expect(model.llm).toHaveBeenCalledTimes(1);
      expect(await prisma.job.count()).toBe(0);

      const messages = await prisma.agentMessage.findMany({ where: { role: 'assistant' } });
      expect(messages[0].parts).toMatchObject([
        { type: 'text' },
        { type: 'code_change', proposal: { status: 'accepted' } },
      ]);
      const staleMirror = [{ role: 'assistant', parts: [{ type: 'code_change', proposal }] }];
      expect(await hydrateCodeProposals(prisma, 'owner', staleMirror)).toMatchObject([
        { parts: [{ proposal: { status: 'accepted' } }] },
      ]);
    },
  );

  it.each<Surface>(['factor', 'strategy'])(
    'isolates %s proposal ownership and host identity',
    async (surface) => {
      const proposal = await generate(surface);
      expect((await request(surface, proposal.id, { userId: 'other' })).status).toBe(404);
      expect((await request(surface, proposal.id, { userId: 'other', read: true })).status).toBe(
        404,
      );
      expect((await request(surface, proposal.id, { entityId: 'unknown' })).status).toBe(404);
      expect(
        (await request(surface === 'factor' ? 'strategy' : 'factor', proposal.id)).status,
      ).toBe(404);
      expect(await currentCode(surface)).toBe(beforeCode);
    },
  );

  it.each<Surface>(['factor', 'strategy'])(
    'rejects %s editor and storage conflicts without resolving the suggestion',
    async (surface) => {
      const proposal = await generate(surface);
      expect((await request(surface, proposal.id, { before: 'manual editor change' })).status).toBe(
        409,
      );
      if (surface === 'factor') {
        await prisma.factor.update({
          where: { id: surface },
          data: { code: 'saved manual change' },
        });
      } else {
        await prisma.strategy.update({
          where: { id: surface },
          data: { config: { code: 'saved manual change' } },
        });
      }
      expect((await request(surface, proposal.id)).status).toBe(409);
      expect(await currentCode(surface)).toBe('saved manual change');
      expect(
        await prisma.agentCodeChangeProposal.findUnique({ where: { id: proposal.id } }),
      ).toMatchObject({ status: 'pending' });
    },
  );

  it.each<Surface>(['factor', 'strategy'])(
    'rejects injected %s replacement code at the request boundary',
    async (surface) => {
      const proposal = await generate(surface);
      const response = await app.request(
        `/${surface === 'factor' ? 'factors' : 'strategies'}/${surface}/code-change-proposals/${proposal.id}/accept`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ beforeCode, afterCode: 'unvalidated replacement' }),
        },
      );
      expect(response.status).toBe(400);
      expect(await currentCode(surface)).toBe(beforeCode);
    },
  );

  it('does not produce a code proposal for an explanation-only response', async () => {
    model.llm.mockResolvedValue({ text: 'No code change is needed.' });
    enqueueAgentTurn({
      turnId: 'answer',
      userId: 'owner',
      entity: { kind: 'strategy', id: 'strategy' },
      profile: { system: 'Explain.' },
      message: 'Explain.',
      currentCode: beforeCode,
    });
    const subscription = turnBus.subscribe('answer', 'owner', () => {});
    if (subscription.kind === 'live') {
      await subscription.closed;
    }
    expect(await prisma.agentCodeChangeProposal.count()).toBe(0);
    expect(await currentCode('strategy')).toBe(beforeCode);
  });

  it('retains strategy parameters changed after generation and clears stale result cache on acceptance', async () => {
    const proposal = await generate('strategy');
    await prisma.strategy.update({
      where: { id: 'strategy' },
      data: {
        config: { code: beforeCode, initialCash: 200000 },
        lastResult: { stale: true },
      },
    });
    expect((await request('strategy', proposal.id)).status).toBe(200);
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { id: 'strategy' } });
    expect(strategy.config).toMatchObject({ code: afterCode, initialCash: 200000 });
    expect(strategy.lastResult).toBeNull();
  });

  it('refuses to modify a factor published while a proposal was pending', async () => {
    const proposal = await generate('factor');
    await prisma.factor.update({ where: { id: 'factor' }, data: { status: 'published' } });
    expect((await request('factor', proposal.id)).status).toBe(409);
    expect(await currentCode('factor')).toBe(beforeCode);
  });
});
