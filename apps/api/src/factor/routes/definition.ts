import { validateJson } from '#infra/http/errors.js';
import { localeFromRequest } from '#infra/http/locale.js';
import { Hono } from 'hono';

import { listFactorCatalog } from '../definitions/catalog.js';
import {
  copyFactorDraft,
  createFactorDraft,
  deleteFactorDraft,
  updateFactorDraft,
} from '../definitions/drafts.js';
import { refreshOwnedFactorMetadata } from '../definitions/metadata.js';
import { listCustomFactors, readFactorDefinition } from '../definitions/read.js';
import { archiveFactor, publishFactor } from '../publication/factor.js';
import { setFactorVisibility } from '../publication/visibility.js';
import {
  createFactorDraftSchema,
  factorMetadataBodySchema,
  factorVisibilitySchema,
  publishFactorBodySchema,
  updateFactorDraftSchema,
} from '../schema.js';

export const factorDefinitionRoute = new Hono();

factorDefinitionRoute.get('/catalog', async (c) => {
  return c.json(await listFactorCatalog(c.var.userId, localeFromRequest(c)));
});

factorDefinitionRoute.get('/', async (c) => {
  return c.json(await listCustomFactors(c.var.userId));
});

factorDefinitionRoute.post('/', validateJson(createFactorDraftSchema), async (c) => {
  return c.json(await createFactorDraft(c.var.userId, c.req.valid('json')));
});

factorDefinitionRoute.post(
  '/:factorId/publish',
  validateJson(publishFactorBodySchema),
  async (c) => {
    return c.json(
      await publishFactor(
        c.var.userId,
        c.req.param('factorId'),
        c.req.valid('json').approvedReportId,
      ),
    );
  },
);

factorDefinitionRoute.post('/:factorId/archive', async (c) => {
  const factor = await archiveFactor(c.var.userId, c.req.param('factorId'));
  return c.json(factor);
});

factorDefinitionRoute.patch(
  '/:factorId/visibility',
  validateJson(factorVisibilitySchema),
  async (c) => {
    return c.json(
      await setFactorVisibility(c.var.userId, c.req.param('factorId'), c.req.valid('json')),
    );
  },
);

factorDefinitionRoute.get('/:factorId', async (c) => {
  return c.json(
    await readFactorDefinition(c.var.userId, c.req.param('factorId'), localeFromRequest(c)),
  );
});

factorDefinitionRoute.patch('/:factorId', validateJson(updateFactorDraftSchema), async (c) => {
  return c.json(
    await updateFactorDraft(c.var.userId, c.req.param('factorId'), c.req.valid('json')),
  );
});

factorDefinitionRoute.delete('/:factorId', async (c) => {
  return c.json(await deleteFactorDraft(c.var.userId, c.req.param('factorId')));
});

factorDefinitionRoute.post('/:factorId/copy', async (c) => {
  return c.json(await copyFactorDraft(c.var.userId, c.req.param('factorId')));
});

factorDefinitionRoute.post(
  '/:factorId/metadata/refresh',
  validateJson(factorMetadataBodySchema),
  async (c) => {
    return c.json(
      await refreshOwnedFactorMetadata(c.var.userId, {
        ...c.req.valid('json'),
        id: c.req.param('factorId'),
      }),
    );
  },
);
