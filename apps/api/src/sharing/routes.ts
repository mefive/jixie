import { copyPublicStrategy } from '#strategy/definitions/copy-public.js';
import { Hono } from 'hono';
import { getPublicStrategy, listSharingCatalog } from './catalog.js';

export const sharingRoute = new Hono();

sharingRoute.get('/', async (c) => {
  return c.json(await listSharingCatalog(c.var.userId, c.var.user));
});

sharingRoute.get('/strategies/:strategyId', async (c) => {
  const strategy = await getPublicStrategy(c.req.param('strategyId'));
  return c.json(strategy);
});

sharingRoute.post('/strategies/:strategyId/copy', async (c) => {
  const copied = await copyPublicStrategy(c.var.userId, c.req.param('strategyId'));
  return c.json(copied);
});
