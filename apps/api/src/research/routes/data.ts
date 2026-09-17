import { validateJson, validateQuery } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { searchResearchDataCatalog } from '../catalog/data-catalog.js';
import { executeUniverseSpec } from '../datasets/universe.js';
import { dataCatalogQuerySchema, universeSpecV1Schema } from '@jixie/shared/api/research';

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
  return c.json(await executeUniverseSpec(c.req.valid('json')));
});
