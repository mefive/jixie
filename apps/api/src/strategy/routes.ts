import { Hono } from 'hono';
import { strategyBacktestRoute } from './backtest-routes.js';
import { strategyScanRoute } from './scan-routes.js';
import { strategyAgentRoute } from './agent-routes.js';
import { strategyDefinitionRoute } from './definition-routes.js';

export const strategyRoute = new Hono();

// Register collection operations before the generic strategy identity route.
strategyRoute.route('/', strategyBacktestRoute);
strategyRoute.route('/', strategyScanRoute);
strategyRoute.route('/', strategyAgentRoute);
strategyRoute.route('/', strategyDefinitionRoute);
