import { Hono } from 'hono';
import { factorResearchRoute } from './research-routes.js';
import { factorWeatherRoute } from './weather-routes.js';
import { factorDefinitionRoute } from './definition-routes.js';

export const factorRoute = new Hono();

// Reserve research and weather paths before matching a factor identity.
factorRoute.route('/', factorResearchRoute);
factorRoute.route('/weather', factorWeatherRoute);
factorRoute.route('/', factorDefinitionRoute);
