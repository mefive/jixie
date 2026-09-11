import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { universeSpecV1Schema } from './datasets/spec.js';
import { executeUniverseSpec } from './datasets/universe.js';
import { searchResearchDataCatalog } from './catalog/data-catalog.js';

export const researchDataRoute = new Hono();

const dataCatalogQuery = z.strictObject({
  q: z.string().trim().max(120).default(''),
  assetType: z.enum(['stock', 'etf', 'index', 'future']).optional(),
  scope: z
    .enum(['instruments', 'datasets', 'factor_reports', 'backtest_reports'])
    .default('instruments'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

researchDataRoute.get('/data-catalog', validateQuery(dataCatalogQuery), async (c) => {
  const query = c.req.valid('query');
  return c.json(
    await searchResearchDataCatalog({
      query: query.q,
      assetType: query.assetType,
      scope: query.scope,
      userId: c.var.userId,
      limit: query.limit,
    }),
  );
});

researchDataRoute.post('/universe-queries', validateJson(universeSpecV1Schema), async (c) => {
  try {
    return c.json(await executeUniverseSpec(c.req.valid('json')));
  } catch (error) {
    return apiError(
      c,
      'VALIDATION_FAILED',
      error instanceof Error ? error.message : 'Universe execution failed.',
    );
  }
});
