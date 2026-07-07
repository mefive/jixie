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
import { apiError, validateJson, validateQuery } from '../lib/httpError.js';
import { chatMessagesSchema } from '../lib/chat-schema.js';
import { prisma } from '../lib/prisma.js';
import { screenProfile } from '../agent/profiles/screen.js';
import { enqueueAgentTurn, entityKey } from '../agent/turn-run.js';
import * as turnBus from '../agent/turn-bus.js';
import { runScreen, stockSeries } from '../screen/query.js';
import { screenSpecSchema } from '../screen/spec.js';

/**
 * Stock screener API (产品线 2 · 卡片墙). POST /screen runs a structured ScreenSpec against the latest
 * snapshot (query cards re-run through here); /screen/agent is one turn of the screening agent;
 * /screen/conversations is the session-card CRUD (messages persisted per conversation, frontend-owned).
 * GET /stock/:code/series returns a stock's OHLC/vol/pe series for the K线/PE/量 charts.
 */
export const screenRoute = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in 交易详情.
screenRoute.get('/names', validateQuery(z.object({ codes: z.string().min(1) })), async (c) => {
  const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
  const rows = await prisma.stockBasic.findMany({
    where: { tsCode: { in: codes } },
    select: { tsCode: true, name: true },
  });
  return c.json(Object.fromEntries(rows.map((r) => [r.tsCode, r.name])) as Record<string, string>);
});

// Index daily close (e.g. 000300.SH 沪深300) over a range — the benchmark return curve in 交易详情.
const idxSeriesQuery = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});
screenRoute.get('/index/:code/series', validateQuery(idxSeriesQuery), async (c) => {
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  const rows = await prisma.indexDaily.findMany({
    where: { tsCode: c.req.param('code'), tradeDate: { gte: start, lte: end } },
    select: { tradeDate: true, close: true },
    orderBy: { tradeDate: 'asc' },
  });
  return c.json({ points: rows.map((r) => ({ date: r.tradeDate, close: r.close })) });
});

screenRoute.post('/screen', validateJson(screenSpecSchema), async (c) => {
  const spec = c.req.valid('json') as ScreenSpec;
  const result = await runScreen(spec);
  return c.json(result);
});

// POST /screen/agent — START one turn of the screening agent (no code artifact) and return a turnId;
// subscribe via GET /api/app/agent/turns/:id/stream. History comes from the conversation row; the
// runner persists the user message + reply onto it (so a refresh mid-turn keeps the conversation).
const agentBody = z.object({
  conversationId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
});

screenRoute.post('/screen/agent', validateJson(agentBody), async (c) => {
  const { conversationId, message } = c.req.valid('json');
  const userId = c.var.userId;
  const conversation = await prisma.screenConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conversation) {
    return apiError(c, 'NOT_FOUND', '会话不存在');
  }
  const entity = { kind: 'screen' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    return apiError(c, 'VALIDATION_FAILED', '该会话已有正在进行的回复,请等它结束或取消');
  }

  const turnId = ulid();
  enqueueAgentTurn({
    turnId,
    userId,
    profile: screenProfile(),
    entity,
    message,
    currentCode: '',
  });
  return c.json({ turnId });
});

// —— Screen conversations (卡片墙的「会话卡片」) —— frontend owns the conversation: it creates the row
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

screenRoute.get('/screen/conversations', async (c) => {
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

screenRoute.get('/screen/conversations/:id', async (c) => {
  const row = await prisma.screenConversation.findFirst({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  if (!row) {
    return apiError(c, 'NOT_FOUND', '会话不存在');
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

screenRoute.post('/screen/conversations', validateJson(conversationCreateBody), async (c) => {
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

screenRoute.post('/screen/conversations/:id', validateJson(conversationUpdateBody), async (c) => {
  const id = c.req.param('id');
  const { title, messages } = c.req.valid('json');
  const existing = await prisma.screenConversation.findFirst({
    where: { id, userId: c.var.userId },
    select: { id: true },
  });
  if (!existing) {
    return apiError(c, 'NOT_FOUND', '会话不存在');
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

screenRoute.delete('/screen/conversations/:id', async (c) => {
  await prisma.screenConversation.deleteMany({
    where: { id: c.req.param('id'), userId: c.var.userId },
  });
  return c.json({ ok: true });
});

const seriesQuery = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

screenRoute.get('/stock/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20241231' } = c.req.valid('query');
  if (start >= end) {
    return apiError(c, 'VALIDATION_FAILED', '起始日期必须早于结束日期');
  }
  const series = await stockSeries(code, start, end);
  if (series.points.length === 0) {
    return apiError(c, 'NOT_FOUND', '该标的在区间内无数据');
  }
  return c.json(series);
});
