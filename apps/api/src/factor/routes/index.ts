import { Hono } from 'hono';
import { factorDefinitionRoute } from './definition.js';
import { factorCompositeRoute } from './composite.js';
import { factorAgentRoute } from './agent.js';
import { factorAnalysisRoute } from './analysis.js';
import { factorCorrelationRoute } from './correlation.js';
import { factorWeatherRoute } from './weather.js';

export const factorRoute = new Hono();

// Register collection resources before the generic factor identity route.
factorRoute.route('/', factorCompositeRoute);
factorRoute.route('/', factorAgentRoute);
factorRoute.route('/', factorAnalysisRoute);
factorRoute.route('/', factorCorrelationRoute);
factorRoute.route('/weather', factorWeatherRoute);
factorRoute.route('/', factorDefinitionRoute);
