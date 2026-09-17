import { Hono } from 'hono';
import { MarketError } from '../errors.js';
import { loadIndexValuation, loadIndexValuationCatalog } from '../valuation/read.js';

export const marketValuationRoute = new Hono();

marketValuationRoute.get('/index-valuations', async (c) => {
  return c.json(await loadIndexValuationCatalog());
});

marketValuationRoute.get('/index-valuations/:indexCode', async (c) => {
  const tsCode = c.req.param('indexCode').toUpperCase();
  const series = await loadIndexValuation(tsCode);
  if (!series) {
    throw new MarketError('no_data');
  }
  return c.json(series);
});
