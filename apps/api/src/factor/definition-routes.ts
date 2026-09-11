import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m, localeFromRequest } from '#infra/http/locale.js';
import { factorOperationApiError, factorPublicationApiError } from './route-errors.js';
import {
  archiveFactor,
  FactorPublicationError,
  publishFactor,
  publishFactorBodySchema,
} from './publication/factor.js';
import { factorVisibilitySchema, setFactorVisibility } from './publication/visibility.js';
import { listFactorCatalog } from './definitions/catalog.js';
import { listCustomFactors, readFactorDefinition } from './definitions/read.js';
import { createFactorDraftSchema, updateFactorDraftSchema } from './definitions/inputs.js';
import {
  createFactorDraft,
  updateFactorDraft,
  deleteFactorDraft,
  copyFactorDraft,
} from './definitions/drafts.js';
import {
  factorMetadataInputSchema,
  refreshOwnedFactorMetadata,
} from './definitions/metadata-operations.js';

export const factorDefinitionRoute = new Hono();

factorDefinitionRoute.get('/catalog', async (c) => {
  try {
    return c.json(await listFactorCatalog(c.var.userId, localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.get('/', async (c) => {
  try {
    return c.json(await listCustomFactors(c.var.userId));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post('/', validateJson(createFactorDraftSchema), async (c) => {
  try {
    return c.json(await createFactorDraft(c.var.userId, c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post(
  '/:factorId/publish',
  validateJson(publishFactorBodySchema),
  async (c) => {
    try {
      return c.json(
        await publishFactor(
          c.var.userId,
          c.req.param('factorId'),
          c.req.valid('json').approvedReportId,
        ),
      );
    } catch (error) {
      if (error instanceof FactorPublicationError) {
        return factorPublicationApiError(c, error);
      }
      throw error;
    }
  },
);

factorDefinitionRoute.post('/:factorId/archive', async (c) => {
  const factor = await archiveFactor(c.var.userId, c.req.param('factorId'));
  return factor ? c.json(factor) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorDefinitionRoute.patch(
  '/:factorId/visibility',
  validateJson(factorVisibilitySchema),
  async (c) => {
    try {
      return c.json(
        await setFactorVisibility(
          c.var.userId,
          c.req.param('factorId'),
          c.req.valid('json'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorDefinitionRoute.get('/:factorId', async (c) => {
  try {
    return c.json(
      await readFactorDefinition(c.var.userId, c.req.param('factorId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.patch('/:factorId', validateJson(updateFactorDraftSchema), async (c) => {
  try {
    return c.json(
      await updateFactorDraft(
        c.var.userId,
        c.req.param('factorId'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.delete('/:factorId', async (c) => {
  try {
    return c.json(
      await deleteFactorDraft(c.var.userId, c.req.param('factorId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post('/:factorId/copy', async (c) => {
  try {
    return c.json(
      await copyFactorDraft(c.var.userId, c.req.param('factorId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post(
  '/:factorId/metadata/refresh',
  validateJson(factorMetadataInputSchema.omit({ id: true })),
  async (c) => {
    try {
      return c.json(
        await refreshOwnedFactorMetadata(
          c.var.userId,
          { ...c.req.valid('json'), id: c.req.param('factorId') },
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);
