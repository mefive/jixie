import { Hono } from 'hono';
import { strategyBacktestRoute } from './backtest.js';
import { strategyScanRoute } from './scan.js';
import { strategyAgentRoute } from './agent.js';
import { strategyDefinitionRoute } from './definition.js';

export const strategyRoute = new Hono();

// Register collection operations before the generic strategy identity route.
strategyRoute.route('/', strategyBacktestRoute);
strategyRoute.route('/', strategyScanRoute);
strategyRoute.route('/', strategyAgentRoute);
strategyRoute.route('/', strategyDefinitionRoute);
