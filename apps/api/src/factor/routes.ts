import { Hono } from 'hono';
import { factorDefinitionRoute } from './definition-routes.js';
import { factorCompositeRoute } from './composite-routes.js';
import { factorAgentRoute } from './agent-routes.js';
import { factorAnalysisRoute } from './analysis-routes.js';
import { factorCorrelationRoute } from './correlation-routes.js';
import { factorWeatherRoute } from './weather-routes.js';

export const factorRoute = new Hono();

// Register collection resources before the generic factor identity route.
factorRoute.route('/', factorCompositeRoute);
factorRoute.route('/', factorAgentRoute);
factorRoute.route('/', factorAnalysisRoute);
factorRoute.route('/', factorCorrelationRoute);
factorRoute.route('/weather', factorWeatherRoute);
factorRoute.route('/', factorDefinitionRoute);
