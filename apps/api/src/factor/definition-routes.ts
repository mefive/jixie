import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { localeFromRequest } from '#infra/http/locale.js';
import {
  archiveFactor,
  FactorPublicationError,
  publishFactor,
  publishFactorBodySchema,
} from './publication/factor.js';
import { archivePanelComposite, publishPanelComposite } from './publication/panel-composite.js';
import {
  factorVisibilitySchema,
  setFactorVisibility,
  setCompositeVisibility,
} from './publication/visibility.js';
import { listFactorCatalog } from './definitions/catalog.js';
import {
  factorCompositeInputSchema,
  readFactorComposite,
  createFactorComposite,
  updateFactorComposite,
  deleteFactorComposite,
  copyFactorComposite,
} from './composition/operations.js';
import { listCustomFactors, readFactorDefinition } from './definitions/read.js';
import { createFactorDraftSchema, updateFactorDraftSchema } from './definitions/inputs.js';
import {
  createFactorDraft,
  updateFactorDraft,
  deleteFactorDraft,
  copyFactorDraft,
} from './definitions/drafts.js';
import { factorOperationApiError } from './route-errors.js';

function factorPublicationApiError(
  c: Parameters<typeof apiError>[0],
  error: FactorPublicationError,
) {
  const messageKey = {
    not_found: 'factorNotFound',
    not_draft: 'publishedFactorReadonly',
    report_invalid: 'factorPublishReportInvalid',
    report_outdated: 'factorPublishReportOutdated',
  }[error.reason] as Parameters<typeof m>[1];
  return apiError(
    c,
    error.reason === 'not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    m(c, messageKey),
  );
}

export const factorDefinitionRoute = new Hono();

factorDefinitionRoute.post(
  '/composites/:compositeId/publish',
  validateJson(publishFactorBodySchema),
  async (c) => {
    try {
      return c.json(
        await publishPanelComposite(
          c.var.userId,
          c.req.param('compositeId'),
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

factorDefinitionRoute.post('/composites/:compositeId/archive', async (c) => {
  const composite = await archivePanelComposite(c.var.userId, c.req.param('compositeId'));
  return composite ? c.json(composite) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorDefinitionRoute.patch(
  '/composites/:compositeId/visibility',
  validateJson(factorVisibilitySchema),
  async (c) => {
    try {
      return c.json(
        await setCompositeVisibility(
          c.var.userId,
          c.req.param('compositeId'),
          c.req.valid('json'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorDefinitionRoute.get('/catalog', async (c) => {
  try {
    return c.json(await listFactorCatalog(c.var.userId, localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.get('/composites/:compositeId', async (c) => {
  try {
    return c.json(
      await readFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post('/composites', validateJson(factorCompositeInputSchema), async (c) => {
  try {
    return c.json(
      await createFactorComposite(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.patch(
  '/composites/:compositeId',
  validateJson(factorCompositeInputSchema),
  async (c) => {
    try {
      return c.json(
        await updateFactorComposite(
          c.var.userId,
          c.req.param('compositeId'),
          c.req.valid('json'),
          localeFromRequest(c),
        ),
      );
    } catch (error) {
      return factorOperationApiError(c, error);
    }
  },
);

factorDefinitionRoute.delete('/composites/:compositeId', async (c) => {
  try {
    return c.json(
      await deleteFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorDefinitionRoute.post('/composites/:compositeId/copy', async (c) => {
  try {
    return c.json(
      await copyFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
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
