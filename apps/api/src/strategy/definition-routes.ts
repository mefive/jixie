import { Hono } from 'hono';
import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { listStrategies, readStrategy } from './definitions/read.js';
import { createStrategySchema, updateStrategySchema } from './definitions/inputs.js';
import { createStrategy, updateStrategy, deleteStrategy } from './definitions/drafts.js';
import { strategyVisibilitySchema, setStrategyVisibility } from './definitions/visibility.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyDefinitionRoute = new Hono();

strategyDefinitionRoute.get('/', async (c) => {
  try {
    return c.json(await listStrategies(c.var.userId));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyDefinitionRoute.get('/:id', async (c) => {
  try {
    return c.json(await readStrategy(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyDefinitionRoute.post('/', validateJson(createStrategySchema), async (c) => {
  try {
    return c.json(await createStrategy(c.var.userId, c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyDefinitionRoute.post(
  '/:id/visibility',
  validateJson(strategyVisibilitySchema),
  async (c) => {
    try {
      return c.json(
        await setStrategyVisibility(
          c.var.userId,
          c.req.param('id'),
          c.req.valid('json'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyDefinitionRoute.post('/:id', validateJson(updateStrategySchema), async (c) => {
  try {
    return c.json(
      await updateStrategy(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyDefinitionRoute.delete('/:id', async (c) => {
  try {
    return c.json(await deleteStrategy(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});
