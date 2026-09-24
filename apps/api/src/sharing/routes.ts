import { copyPublicStrategy } from '#strategy/definitions/copy-public.js';
import { Hono } from 'hono';
import { listSharingCatalog } from './catalog.js';

export const sharingRoute = new Hono();

sharingRoute.get('/', async (c) => {
  return c.json(await listSharingCatalog(c.var.userId, c.var.user));
});

sharingRoute.post('/strategies/:strategyId/copy', async (c) => {
  const copied = await copyPublicStrategy(c.var.userId, c.req.param('strategyId'));
  return c.json(copied);
});
