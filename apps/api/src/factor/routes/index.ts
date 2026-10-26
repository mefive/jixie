import { Hono } from 'hono';
import { factorDefinitionRoute } from './definition.js';
import { factorAgentRoute } from './agent.js';
import { factorAnalysisRoute } from './analysis.js';

export const factorRoute = new Hono();

// Register collection resources before the generic factor identity route.
factorRoute.route('/', factorAgentRoute);
factorRoute.route('/', factorAnalysisRoute);
factorRoute.route('/', factorDefinitionRoute);
