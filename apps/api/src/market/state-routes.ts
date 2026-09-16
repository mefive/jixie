import { marketStateQuerySchema, marketWeatherQuerySchema } from './schema.js';
import { Hono } from 'hono';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { loadMarketState } from './state/read.js';
import { loadMarketWeather } from './state/weather.js';

export const marketStateRoute = new Hono();

marketStateRoute.get('/weather', validateQuery(marketWeatherQuerySchema), async (c) => {
  const { dimension, frequency } = c.req.valid('query');
  const series = await loadMarketWeather(dimension, frequency);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

marketStateRoute.get('/state', validateQuery(marketStateQuerySchema), async (c) => {
  const scope = c.req.valid('query').scope;
  const snapshot = await loadMarketState(scope);
  if (!snapshot) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(snapshot);
});
