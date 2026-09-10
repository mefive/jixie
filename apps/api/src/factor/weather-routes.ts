import { Hono } from 'hono';
import { validateJson } from '#infra/http/errors.js';
import {
  createFactorWeatherPinSchema,
  listFactorWeatherPins,
  createFactorWeatherPin,
  requestFactorWeatherRefresh,
  deleteFactorWeatherPin,
} from './weather/pins.js';
import { factorOperationApiError } from './route-errors.js';
import { localeFromRequest } from '#infra/http/locale.js';

export const factorWeatherRoute = new Hono();

factorWeatherRoute.get('/', async (c) => {
  try {
    return c.json(await listFactorWeatherPins(c.var.userId, localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorWeatherRoute.post('/pins', validateJson(createFactorWeatherPinSchema), async (c) => {
  try {
    return c.json(
      await createFactorWeatherPin(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorWeatherRoute.post('/pins/:id/refresh', async (c) => {
  try {
    return c.json(
      await requestFactorWeatherRefresh(c.var.userId, c.req.param('id'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorWeatherRoute.delete('/pins/:id', async (c) => {
  try {
    return c.json(
      await deleteFactorWeatherPin(c.var.userId, c.req.param('id'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
