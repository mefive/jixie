import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { MARKET_STATE_INDEX_CODES } from './registry/index-presets.js';
import { loadMarketState } from './state/read.js';
import { loadMarketWeather } from './state/weather.js';

export const marketStateRoute = new Hono();

const marketStateScopes = ['all', ...MARKET_STATE_INDEX_CODES] as const;

const marketStateQuery = z.object({
  scope: z.enum(marketStateScopes).default('all'),
});

const marketWeatherFrequencies = ['week', 'month', 'quarter', 'year'] as const;

const marketWeatherDimensions = ['industry', 'scale', 'board', 'style'] as const;

const marketWeatherQuery = z.object({
  dimension: z.enum(marketWeatherDimensions).default('industry'),
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});

marketStateRoute.get('/weather', validateQuery(marketWeatherQuery), async (c) => {
  const { dimension, frequency } = c.req.valid('query');
  const series = await loadMarketWeather(dimension, frequency);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

marketStateRoute.get('/state', validateQuery(marketStateQuery), async (c) => {
  const scope = c.req.valid('query').scope;
  const snapshot = await loadMarketState(scope);
  if (!snapshot) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(snapshot);
});
