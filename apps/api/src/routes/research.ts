import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { apiError, validateJson } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { researchProfile } from '../agent/profiles/research.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { localeFromRequest, m } from '../i18n/index.js';
import { researchCapabilityCatalog } from '../research/catalog.js';
import { executeResearchPlan } from '../research/executor.js';
import {
  createFailedResearchAttempt,
  createResearchRerun,
  listResearchStudyAttempts,
  listResearchStudyRuns,
} from '../research/records.js';
import { researchPlanSpecV1Schema } from '../research/spec.js';
import { universeSpecV1Schema } from '../research/spec.js';
import { executeUniverseSpec } from '../research/universe.js';

/** Natural-language research workbench actions. Persistence and Agent turns join this route in M1. */
export const researchRoute = new Hono();

researchRoute.get('/catalog', (c) => c.json(researchCapabilityCatalog));

researchRoute.get('/conversations', async (c) => {
  const conversations = await prisma.agentConversation.findMany({
    where: { userId: c.var.userId, surface: 'research', archivedAt: null },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return c.json(
    conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title ?? '',
      preview: messagePreview(conversation.messages[0]?.parts),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    })),
  );
});

const agentBody = z.strictObject({
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(2000),
});

researchRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { message } = c.req.valid('json');
  const userId = c.var.userId;
  let conversationId = c.req.valid('json').conversationId;
  if (conversationId) {
    const existing = await prisma.agentConversation.findFirst({
      where: { id: conversationId, userId, surface: 'research', archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
    }
  } else {
    conversationId = ulid();
    await prisma.agentConversation.create({
      data: {
        id: conversationId,
        userId,
        surface: 'research',
        title: message.slice(0, 60),
      },
    });
  }
  const entity = { kind: 'research' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'conversationTurnInProgress'));
  }
  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: researchProfile(),
    entity,
    message,
    currentCode: '',
    locale: localeFromRequest(c),
  });
  return c.json({ conversationId, turnId });
});

const renameBody = z.strictObject({ title: z.string().trim().min(1).max(120) });

researchRoute.patch('/conversations/:id', validateJson(renameBody), async (c) => {
  const updated = await prisma.agentConversation.updateMany({
    where: {
      id: c.req.param('id'),
      userId: c.var.userId,
      surface: 'research',
      archivedAt: null,
    },
    data: { title: c.req.valid('json').title },
  });
  return updated.count === 1
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.delete('/conversations/:id', async (c) => {
  const deleted = await prisma.agentConversation.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId, surface: 'research' },
  });
  return deleted.count === 1
    ? c.json({ ok: true as const })
    : apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
});

researchRoute.post('/run', validateJson(researchPlanSpecV1Schema), async (c) => {
  try {
    return c.json(await executeResearchPlan(c.req.valid('json')));
  } catch (error) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      error instanceof Error ? error.message : 'Research plan failed.',
    );
  }
});

const rerunBody = z.strictObject({
  parentRunId: z.string().min(1),
  plan: researchPlanSpecV1Schema,
});

researchRoute.get('/studies/:studyId/runs', async (c) => {
  const records = await listResearchStudyRuns(c.var.userId, c.req.param('studyId'));
  return records ? c.json(records) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
});

researchRoute.get('/studies/:studyId/attempts', async (c) => {
  const attempts = await listResearchStudyAttempts(c.var.userId, c.req.param('studyId'));
  return attempts ? c.json(attempts) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
});

researchRoute.post('/studies/:studyId/runs', validateJson(rerunBody), async (c) => {
  const { parentRunId, plan } = c.req.valid('json');
  const studyId = c.req.param('studyId');
  const parent = await prisma.researchRun.findFirst({
    where: { id: parentRunId, studyId, study: { userId: c.var.userId, status: 'active' } },
    select: { id: true },
  });
  if (!parent) {
    return apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
  }
  try {
    const run = await executeResearchPlan(plan);
    const record = await createResearchRerun({
      userId: c.var.userId,
      studyId,
      parentRunId,
      run,
    });
    return record ? c.json(record) : apiError(c, 'NOT_FOUND', m(c, 'researchStudyNotFound'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research plan failed.';
    const attempt = await createFailedResearchAttempt({
      userId: c.var.userId,
      studyId,
      parentRunId,
      plan,
      error: message,
    });
    return apiError(c, 'VALIDATION_FAILED', message, attempt ? { attempt } : undefined);
  }
});

researchRoute.post('/universe/run', validateJson(universeSpecV1Schema), async (c) => {
  try {
    return c.json(await executeUniverseSpec(c.req.valid('json')));
  } catch (error) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      error instanceof Error ? error.message : 'Universe execution failed.',
    );
  }
});

function messagePreview(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  const text = parts.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string',
  );
  if (text) {
    return text.text.slice(0, 80);
  }
  const artifact = parts.find(
    (part): part is { type: 'research' | 'universe'; title: string } =>
      typeof part === 'object' &&
      part !== null &&
      ['research', 'universe'].includes((part as { type?: string }).type ?? '') &&
      typeof (part as { title?: unknown }).title === 'string',
  );
  return artifact?.title.slice(0, 80) ?? '';
}
