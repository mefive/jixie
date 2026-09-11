import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m, localeFromRequest } from '#infra/http/locale.js';
import { factorOperationApiError, factorPublicationApiError } from './route-errors.js';
import { FactorPublicationError, publishFactorBodySchema } from './publication/factor.js';
import { archivePanelComposite, publishPanelComposite } from './publication/panel-composite.js';
import { factorVisibilitySchema, setCompositeVisibility } from './publication/visibility.js';
import {
  factorCompositeInputSchema,
  readFactorComposite,
  createFactorComposite,
  updateFactorComposite,
  deleteFactorComposite,
  copyFactorComposite,
} from './composition/operations.js';

export const factorCompositeRoute = new Hono();

factorCompositeRoute.post(
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

factorCompositeRoute.post('/composites/:compositeId/archive', async (c) => {
  const composite = await archivePanelComposite(c.var.userId, c.req.param('compositeId'));
  return composite ? c.json(composite) : apiError(c, 'NOT_FOUND', m(c, 'factorNotFound'));
});

factorCompositeRoute.patch(
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

factorCompositeRoute.get('/composites/:compositeId', async (c) => {
  try {
    return c.json(
      await readFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorCompositeRoute.post('/composites', validateJson(factorCompositeInputSchema), async (c) => {
  try {
    return c.json(
      await createFactorComposite(c.var.userId, c.req.valid('json'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorCompositeRoute.patch(
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

factorCompositeRoute.delete('/composites/:compositeId', async (c) => {
  try {
    return c.json(
      await deleteFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});

factorCompositeRoute.post('/composites/:compositeId/copy', async (c) => {
  try {
    return c.json(
      await copyFactorComposite(c.var.userId, c.req.param('compositeId'), localeFromRequest(c)),
    );
  } catch (error) {
    return factorOperationApiError(c, error);
  }
});
