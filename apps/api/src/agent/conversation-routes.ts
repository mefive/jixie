import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { listConversationMessages } from './conversations/read.js';

export const agentConversationRoute = new Hono();

const messagesQuery = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

agentConversationRoute.get(
  '/conversations/:conversationId/messages',
  validateQuery(messagesQuery),
  async (c) => {
    const result = await listConversationMessages(
      c.var.userId,
      c.req.param('conversationId'),
      c.req.valid('query'),
    );
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'turnNotFound'));
  },
);
