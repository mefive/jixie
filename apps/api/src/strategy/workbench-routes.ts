import { Hono } from 'hono';
import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { strategyAgentInputSchema, startStrategyAgentTurn } from './agent-turn.js';
import { strategyNameInputSchema, requestStrategyName } from './definitions/name-request.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyWorkbenchRoute = new Hono();

strategyWorkbenchRoute.post(
  '/:strategyId/agent/turns',
  validateJson(strategyAgentInputSchema.omit({ id: true })),
  async (c) => {
    try {
      return c.json(
        await startStrategyAgentTurn(
          c.var.userId,
          { ...c.req.valid('json'), id: c.req.param('strategyId') },
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);

strategyWorkbenchRoute.post(
  '/name-suggestions',
  validateJson(strategyNameInputSchema),
  async (c) => {
    try {
      return c.json(await requestStrategyName(c.req.valid('json'), localeFromRequest(c)));
    } catch (error) {
      return strategyOperationApiError(c, error);
    }
  },
);
