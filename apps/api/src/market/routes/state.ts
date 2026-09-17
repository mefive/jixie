import { validateQuery } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { MarketError } from '../errors.js';
import { marketStateQuerySchema, marketWeatherQuerySchema } from '../schema.js';
import { loadMarketState } from '../state/read.js';
import { loadMarketWeather } from '../state/weather.js';

export const marketStateRoute = new Hono();

marketStateRoute.get('/weather', validateQuery(marketWeatherQuerySchema), async (c) => {
  const { dimension, frequency } = c.req.valid('query');
  const series = await loadMarketWeather(dimension, frequency);
  if (!series) {
    throw new MarketError('no_data');
  }
  return c.json(series);
});

marketStateRoute.get('/state', validateQuery(marketStateQuerySchema), async (c) => {
  const scope = c.req.valid('query').scope;
  const snapshot = await loadMarketState(scope);
  if (!snapshot) {
    throw new MarketError('no_data');
  }
  return c.json(snapshot);
});
