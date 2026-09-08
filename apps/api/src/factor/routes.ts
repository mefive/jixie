import { Hono } from 'hono';
import { apiError, validateJson } from '../infra/http/errors.js';
import { m } from '../infra/http/locale.js';
import { localeFromRequest } from '../infra/http/locale.js';
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

export const factorsRoute = new Hono();

factorsRoute.post('/custom/:id/publish', validateJson(publishFactorBodySchema), async (c) => {
  try {
    return c.json(
      await publishFactor(c.var.userId, c.req.param('id'), c.req.valid('json').approvedReportId),
    );
  } catch (error) {
    if (error instanceof FactorPublicationError) {
      return factorPublicationApiError(c, error);
    }
    throw error;
  }
});

factorsRoute.post('/custom/:id/archive', async (c) => {
  const factor = await archiveFactor(c.var.userId, c.req.param('id'));
  return factor ? c.json(factor) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.post('/custom/:id/visibility', validateJson(factorVisibilitySchema), async (c) => {
  try {
    return c.json(
      await setFactorVisibility(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/composites/:id/publish', validateJson(publishFactorBodySchema), async (c) => {
  try {
    return c.json(
      await publishPanelComposite(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json').approvedReportId,
      ),
    );
  } catch (error) {
    if (error instanceof FactorPublicationError) {
      return factorPublicationApiError(c, error);
    }
    throw error;
  }
});

factorsRoute.post('/composites/:id/archive', async (c) => {
  const composite = await archivePanelComposite(c.var.userId, c.req.param('id'));
  return composite ? c.json(composite) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorsRoute.post('/composites/:id/visibility', validateJson(factorVisibilitySchema), async (c) => {
  try {
    return c.json(
      await setCompositeVisibility(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.get('/catalog', async (c) => {
  try {
    return c.json(await listFactorCatalog(c.var.userId, localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.get('/composites/:id', async (c) => {
  try {
    return c.json(await readFactorComposite(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/composites', validateJson(factorCompositeInputSchema), async (c) => {
  try {
    return c.json(
      await createFactorComposite(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/composites/:id', validateJson(factorCompositeInputSchema), async (c) => {
  try {
    return c.json(
      await updateFactorComposite(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.delete('/composites/:id', async (c) => {
  try {
    return c.json(
      await deleteFactorComposite(c.var.userId, c.req.param('id'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/composites/:id/copy', async (c) => {
  try {
    return c.json(await copyFactorComposite(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.get('/custom', async (c) => {
  try {
    return c.json(await listCustomFactors(c.var.userId));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.get('/custom/:id', async (c) => {
  try {
    return c.json(
      await readFactorDefinition(c.var.userId, c.req.param('id'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/custom', validateJson(createFactorDraftSchema), async (c) => {
  try {
    return c.json(await createFactorDraft(c.var.userId, c.req.valid('json'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/custom/:id', validateJson(updateFactorDraftSchema), async (c) => {
  try {
    return c.json(
      await updateFactorDraft(
        c.var.userId,
        c.req.param('id'),
        c.req.valid('json'),
        localeFromRequest(c),
      ),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.delete('/custom/:id', async (c) => {
  try {
    return c.json(await deleteFactorDraft(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorsRoute.post('/custom/:id/copy', async (c) => {
  try {
    return c.json(await copyFactorDraft(c.var.userId, c.req.param('id'), localeFromRequest(c)));
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
