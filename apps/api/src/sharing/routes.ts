import { Hono } from 'hono';
import { apiError } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { copyPublicStrategy } from '#strategy/definitions/copy-public.js';
import { listSharingCatalog, getPublicStrategy } from './catalog.js';

export const sharingRoute = new Hono();

sharingRoute.get('/', async (c) => {
  return c.json(await listSharingCatalog(c.var.userId, c.var.user));
});

sharingRoute.get('/strategies/:strategyId', async (c) => {
  const strategy = await getPublicStrategy(c.req.param('strategyId'));
  return strategy ? c.json(strategy) : apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
});

sharingRoute.post('/strategies/:strategyId/copy', async (c) => {
  const copied = await copyPublicStrategy(c.var.userId, c.req.param('strategyId'));
  return copied ? c.json(copied) : apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
});
