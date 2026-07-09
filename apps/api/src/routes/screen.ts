import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type {
  ChatMessage,
  MessagePart,
  ScreenConversationDetail,
  ScreenConversationMeta,
  ScreenSpec,
} from '@jixie/shared';
import { apiError, validateJson } from '../lib/httpError.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { prisma } from '../lib/prisma.js';
import { screenProfile } from '../agent/profiles/screen.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { runScreen } from '../screen/query.js';
import { screenSpecSchema } from '../screen/spec.js';
import { localeFromRequest, m } from '../i18n/index.js';

/**
 * Screener workbench actions (product line 2 · card wall, mounted at /api/app/screen):
 *   POST /run runs a structured ScreenSpec against the latest snapshot (query cards re-run through
 *   here); POST /agent is one turn of the screening agent; /conversations is the session-card CRUD
 *   (messages persisted per conversation, frontend-owned). Market read-only helpers live in market.ts.
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const screenRoute = new Hono();

screenRoute.post('/run', validateJson(screenSpecSchema), async (c) => {
  const spec = c.req.valid('json') as ScreenSpec;
  const result = await runScreen(spec);
  return c.json(result);
});

// POST /agent — START one turn of the screening agent (no code artifact) and return a turnId;
// subscribe via GET /api/app/agent/turns/:id/stream. History comes from the conversation row; the
// runner persists the user message + reply onto it (so a refresh mid-turn keeps the conversation).
const agentBody = z.object({
  conversationId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
});

screenRoute.post('/agent', validateJson(agentBody), async (c) => {
  const { conversationId, message } = c.req.valid('json');
  const userId = c.var.userId;
  const conversation = await prisma.screenConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) {
    return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  }
  const entity = { kind: 'screen' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'conversationTurnInProgress'));
  }

  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: screenProfile(),
    entity,
    message,
    currentCode: '',
    locale: localeFromRequest(c),
  });
  return c.json({ turnId });
});

// —— Screen conversations (the card wall's "conversation cards") —— frontend owns the conversation: it creates the row
// on the first turn and PATCH-saves messages after each turn. Deleting one never touches SavedScreen.

/** The wall card's summary: last message's text (truncated) + how many query cards the chat holds. */
function conversationSummary(messages: ChatMessage[]): { preview: string; cardCount: number } {
  const last = messages[messages.length - 1];
  const lastText =
    last?.parts.find((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
      ?.text ?? '';
  const cardCount = messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === 'card').length;
  return { preview: lastText.slice(0, 60), cardCount };
}

screenRoute.get('/conversations', async (c) => {
  const rows = await prisma.screenConversation.findMany({
    where: { userId: c.var.userId },
    orderBy: { updatedAt: 'desc' },
  });
  const metas = rows.map((row): ScreenConversationMeta => {
    const { preview, cardCount } = conversationSummary(
      (row.messages ?? []) as unknown as ChatMessage[],
    );
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      preview,
      cardCount,
    };
  });
  return c.json(metas);
});

screenRoute.get('/conversations/:id', async (c) => {
  const row = await prisma.screenConversation.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  }
  return c.json({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: (row.messages ?? []) as unknown as ChatMessage[],
  } satisfies ScreenConversationDetail);
});

const conversationCreateBody = z.object({
  title: z.string().trim().min(1).max(60),
  messages: chatMessagesSchema,
});

screenRoute.post('/conversations', validateJson(conversationCreateBody), async (c) => {
  const { title, messages } = c.req.valid('json');
  const id = ulid();
  await prisma.screenConversation.create({
    data: {
      id,
      userId: c.var.userId,
      title,
      messages: messages as Prisma.InputJsonValue,
    },
  });
  return c.json({ id, title });
});

// POST /:id — update: `{ messages }` = real-time chat save; `{ title }` = rename. Either or both.
const conversationUpdateBody = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  messages: chatMessagesSchema.optional(),
});

screenRoute.post('/conversations/:id', validateJson(conversationUpdateBody), async (c) => {
  const id = c.req.param('id');
  const { title, messages } = c.req.valid('json');
  const existing = await prisma.screenConversation.findFirst({
    where: { id, userId: c.var.userId },
    select: { id: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', m(c, 'conversationNotFound'));
  }

  await prisma.screenConversation.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(messages !== undefined ? { messages: messages as Prisma.InputJsonValue } : {}),
    },
  });
  return c.json({ ok: true });
});

screenRoute.delete('/conversations/:id', async (c) => {
  await prisma.screenConversation.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  return c.json({ ok: true });
});
