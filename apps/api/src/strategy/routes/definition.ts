import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';
import { createStrategy, deleteStrategy } from '../definitions/drafts.js';
import { listStrategies, readStrategy } from '../definitions/read.js';
import { setStrategyVisibility } from '../definitions/visibility.js';
import { createStrategySchema, strategyVisibilitySchema } from '@jixie/shared/api/strategy';

export const strategyDefinitionRoute = new Hono();

strategyDefinitionRoute.get('/', async (c) => {
  return c.json(await listStrategies(c.var.userId));
});

strategyDefinitionRoute.get('/:strategyId', async (c) => {
  return c.json(await readStrategy(c.var.userId, c.req.param('strategyId')));
});

strategyDefinitionRoute.post('/', validateJson(createStrategySchema), async (c) => {
  return c.json(await createStrategy(c.var.userId, c.req.valid('json'), localeFromRequest(c)));
});

strategyDefinitionRoute.patch(
  '/:strategyId/visibility',
  validateJson(strategyVisibilitySchema),
  async (c) => {
    return c.json(
      await setStrategyVisibility(c.var.userId, c.req.param('strategyId'), c.req.valid('json')),
    );
  },
);

strategyDefinitionRoute.delete('/:strategyId', async (c) => {
  return c.json(await deleteStrategy(c.var.userId, c.req.param('strategyId')));
});
