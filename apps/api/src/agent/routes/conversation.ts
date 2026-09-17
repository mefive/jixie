import { validateQuery } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { listConversationMessages } from '../conversations/read.js';
import { conversationMessagesQuerySchema } from '../schema.js';

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
    return c.json(result);
  },
);
