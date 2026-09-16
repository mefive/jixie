import { dataCatalogQuerySchema, universeSpecV1Schema } from '../schema.js';
import { Hono } from 'hono';
import { apiError, validateJson, validateQuery } from '#infra/http/errors.js';
import { executeUniverseSpec } from '../datasets/universe.js';
import { searchResearchDataCatalog } from '../catalog/data-catalog.js';

export const researchDataRoute = new Hono();

researchDataRoute.get('/data-catalog', validateQuery(dataCatalogQuerySchema), async (c) => {
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
