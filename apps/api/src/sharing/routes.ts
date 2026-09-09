import { Hono } from 'hono';
import { apiError } from '../infra/http/errors.js';
import { m } from '../infra/http/locale.js';
import { copyPublicStrategy } from '../strategy/definitions/copy-public.js';
import { listSharingCatalog, getPublicStrategy } from './catalog.js';

export const routes = new Hono();

routes.get('/', async (c) => {
  return c.json(await listSharingCatalog(c.var.userId, c.var.user));
});

routes.get('/strategies/:id', async (c) => {
  const strategy = await getPublicStrategy(c.req.param('id'));
  return strategy ? c.json(strategy) : apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
});

routes.post('/strategies/:id/copy', async (c) => {
  const copied = await copyPublicStrategy(c.var.userId, c.req.param('id'));
  return copied ? c.json(copied) : apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'));
});
