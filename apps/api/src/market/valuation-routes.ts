import { Hono } from 'hono';
import { apiError } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { loadIndexValuation, loadIndexValuationCatalog } from './valuation/read.js';

export const marketValuationRoute = new Hono();

marketValuationRoute.get('/index-valuations', async (c) => {
  return c.json(await loadIndexValuationCatalog());
});

marketValuationRoute.get('/index-valuations/:indexCode', async (c) => {
  const tsCode = c.req.param('indexCode').toUpperCase();
  const series = await loadIndexValuation(tsCode);
  if (!series) {
    return apiError(c, 'NOT_FOUND', m(c, 'noDataInRange'));
  }
  return c.json(series);
});
