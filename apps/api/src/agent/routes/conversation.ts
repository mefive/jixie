import { conversationMessagesQuerySchema } from '../schema.js';
import { Hono } from 'hono';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { listConversationMessages } from '../conversations/read.js';

export const agentConversationRoute = new Hono();

agentConversationRoute.get(
  '/conversations/:conversationId/messages',
  validateQuery(conversationMessagesQuerySchema),
  async (c) => {
    const result = await listConversationMessages(
      c.var.userId,
      c.req.param('conversationId'),
      c.req.valid('query'),
    );
    return result ? c.json(result) : apiError(c, 'NOT_FOUND', m(c, 'turnNotFound'));
  },
);
