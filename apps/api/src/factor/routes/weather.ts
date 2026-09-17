import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { createFactorWeatherPinSchema } from '../schema.js';
import {
  createFactorWeatherPin,
  deleteFactorWeatherPin,
  listFactorWeatherPins,
  requestFactorWeatherRefresh,
} from '../weather/pins.js';

import { localeFromRequest } from '#infra/http/locale.js';

export const factorWeatherRoute = new Hono();

factorWeatherRoute.get('/', async (c) => {
  return c.json(await listFactorWeatherPins(c.var.userId, localeFromRequest(c)));
});

factorWeatherRoute.post('/pins', validateJson(createFactorWeatherPinSchema), async (c) => {
  return c.json(await createFactorWeatherPin(c.var.userId, c.req.valid('json')));
});

factorWeatherRoute.post('/pins/:pinId/refresh', async (c) => {
  return c.json(await requestFactorWeatherRefresh(c.var.userId, c.req.param('pinId')));
});

factorWeatherRoute.delete('/pins/:pinId', async (c) => {
  return c.json(await deleteFactorWeatherPin(c.var.userId, c.req.param('pinId')));
});
