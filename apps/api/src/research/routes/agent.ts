import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { startResearchAgentTurn } from '../agent/turn.js';
import { researchAgentInputSchema } from '../schema.js';

export const researchAgentRoute = new Hono();

researchAgentRoute.post('/agent/turns', validateJson(researchAgentInputSchema), async (c) => {
  return c.json(
    await startResearchAgentTurn(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
  );
});
