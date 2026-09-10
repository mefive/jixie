import { Hono } from 'hono';
import { routes as backtestRoutes } from './backtest-routes.js';
import { routes as scanRoutes } from './scan-routes.js';
import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { strategyAgentInputSchema, startStrategyAgentTurn } from './agent-turn.js';
import { strategyNameInputSchema, requestStrategyName } from './definitions/name-request.js';
import { strategyOperationApiError } from './route-errors.js';

export const routes = new Hono();

routes.route('/backtest', backtestRoutes);
routes.route('/scans', scanRoutes);

routes.post('/agent', validateJson(strategyAgentInputSchema), async (c) => {
  try {
    return c.json(
      await startStrategyAgentTurn(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

routes.post('/name', validateJson(strategyNameInputSchema), async (c) => {
  try {
    return c.json(await requestStrategyName(c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});
