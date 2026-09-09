import type { MarketWeatherFrequency } from '@jixie/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateQuery } from '../infra/http/errors.js';
import { m } from '../infra/http/locale.js';
import { loadInstrumentNames } from './instruments/names.js';
import { loadFutureSeries } from './queries/future-series.js';
import { loadIndexSeries } from './queries/index-series.js';
import { instrumentSeries } from './queries/instrument-series.js';
import { MARKET_STATE_INDEX_CODES } from './registry/index-presets.js';
import { loadMarketState } from './state/read.js';
import { loadIndustryWeatherSeries, loadMarketWeather } from './state/weather.js';
import { loadIndexValuation, loadIndexValuationCatalog } from './valuation/read.js';

/**
 * Market HTTP reads (mounted at /api/app/market):
 *   GET /names?codes=                 tsCode → name (bulk) — e.g. the traded-instruments queue
 *   GET /objects/:assetType/:id/series a verified stock/ETF/index/future daily series
 *   GET /indices/:code/series         index daily close — the benchmark return curve in trade details
 *   GET /indices/valuation/catalog    broad-index valuation coverage
 *   GET /indices/:code/valuation      index close + valuation history and current percentiles
 *   GET /weather?dimension=&frequency= replayable card-only market weather dimensions
 *   GET /industry-weather?frequency=  legacy SW level-1 industry weather periods
 *   GET /state?scope=                  whole-market/index pulse + Shenwan level-1 direction heat
 * Naming rules: see docs/design/api-route-naming.md.
 */
export const routes = new Hono();

// tsCode → name (bulk) — e.g. the traded-instruments queue in trade details.
routes.get('/names', validateQuery(z.object({ codes: z.string().min(1) })), async (c) => {
  const codes = c.req.valid('query').codes.split(',').filter(Boolean).slice(0, 500);
  return c.json(await loadInstrumentNames(codes));
});

const seriesQuery = z.object({
  start: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
});

const marketStateScopes = ['all', ...MARKET_STATE_INDEX_CODES] as const;
const marketStateQuery = z.object({
  scope: z.enum(marketStateScopes).default('all'),
});
const marketWeatherFrequencies = ['week', 'month', 'quarter', 'year'] as const;
const industryWeatherQuery = z.object({
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});
const marketWeatherDimensions = ['industry', 'scale', 'board', 'style'] as const;
const marketWeatherQuery = z.object({
  dimension: z.enum(marketWeatherDimensions).default('industry'),
  frequency: z.enum(marketWeatherFrequencies).default('month'),
});

routes.get('/objects/:assetType/:id/series', validateQuery(seriesQuery), async (c) => {
  const assetType = z.enum(['stock', 'etf', 'index', 'future']).safeParse(c.req.param('assetType'));
  if (!assetType.success) {
    return apiError(c, 'VALIDATION_FAILED', 'Unsupported object type.');
  }
  const id = c.req.param('id');
  const { start, end } = c.req.valid('query');
  if (start && end && start >= end) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'startAfterEnd'));
  }
  const series = await instrumentSeries(assetType.data, id, start, end);
  if (series.points.length === 0) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

routes.get('/indices/valuation/catalog', async (c) => {
  return c.json(await loadIndexValuationCatalog());
});

routes.get('/indices/:code/valuation', async (c) => {
  const tsCode = c.req.param('code').toUpperCase();
  const series = await loadIndexValuation(tsCode);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

routes.get('/weather', validateQuery(marketWeatherQuery), async (c) => {
  const { dimension, frequency } = c.req.valid('query');
  const series = await loadMarketWeather(dimension, frequency);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});

routes.get('/industry-weather', validateQuery(industryWeatherQuery), async (c) => {
  const frequency = c.req.valid('query').frequency as MarketWeatherFrequency;
  const series = await loadIndustryWeatherSeries(frequency);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }

  return c.json(series);
});

routes.get('/state', validateQuery(marketStateQuery), async (c) => {
  const scope = c.req.valid('query').scope;
  const snapshot = await loadMarketState(scope);
  if (!snapshot) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(snapshot);
});

// Index daily close (e.g. 000300.SH CSI 300) over a range — the benchmark return curve in trade details.
routes.get('/indices/:code/series', validateQuery(seriesQuery), async (c) => {
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  return c.json(await loadIndexSeries(c.req.param('code'), start, end));
});

// Actual or point-in-time mapped continuous stock-index futures OHLC series.
routes.get('/futures/:code/series', validateQuery(seriesQuery), async (c) => {
  const code = c.req.param('code');
  const { start = '20150101', end = '20261231' } = c.req.valid('query');
  const series = await loadFutureSeries(code, start, end);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});
