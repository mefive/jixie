import { Hono } from 'hono';
import { strategyBacktestRoute } from './backtest-routes.js';
import { strategyScanRoute } from './scan-routes.js';
import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { strategyAgentInputSchema, startStrategyAgentTurn } from './agent-turn.js';
import { strategyNameInputSchema, requestStrategyName } from './definitions/name-request.js';
import { strategyOperationApiError } from './route-errors.js';

export const strategyRoute = new Hono();

strategyRoute.route('/backtest', strategyBacktestRoute);
strategyRoute.route('/scans', strategyScanRoute);

strategyRoute.post('/agent', validateJson(strategyAgentInputSchema), async (c) => {
  try {
    return c.json(
      await startStrategyAgentTurn(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});

strategyRoute.post('/name', validateJson(strategyNameInputSchema), async (c) => {
  try {
    return c.json(await requestStrategyName(c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return strategyOperationApiError(c, error);
  }
});
