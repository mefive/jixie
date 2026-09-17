import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';

import {
  copyFactorComposite,
  createFactorComposite,
  deleteFactorComposite,
  readFactorComposite,
  updateFactorComposite,
} from '../composition/operations.js';
import { archivePanelComposite, publishPanelComposite } from '../publication/panel-composite.js';
import { setCompositeVisibility } from '../publication/visibility.js';
import {
  factorCompositeInputSchema,
  factorVisibilitySchema,
  publishFactorBodySchema,
} from '../schema.js';

export const factorCompositeRoute = new Hono();

factorCompositeRoute.post(
  '/composites/:compositeId/publish',
  validateJson(publishFactorBodySchema),
  async (c) => {
    return c.json(
      await publishPanelComposite(
        c.var.userId,
        c.req.param('compositeId'),
        c.req.valid('json').approvedReportId,
      ),
    );
  },
);

factorCompositeRoute.post('/composites/:compositeId/archive', async (c) => {
  const composite = await archivePanelComposite(c.var.userId, c.req.param('compositeId'));
  return c.json(composite);
});

factorCompositeRoute.patch(
  '/composites/:compositeId/visibility',
  validateJson(factorVisibilitySchema),
  async (c) => {
    return c.json(
      await setCompositeVisibility(c.var.userId, c.req.param('compositeId'), c.req.valid('json')),
    );
  },
);

factorCompositeRoute.get('/composites/:compositeId', async (c) => {
  return c.json(await readFactorComposite(c.var.userId, c.req.param('compositeId')));
});

factorCompositeRoute.post('/composites', validateJson(factorCompositeInputSchema), async (c) => {
  return c.json(await createFactorComposite(c.var.userId, c.req.valid('json')));
});

factorCompositeRoute.patch(
  '/composites/:compositeId',
  validateJson(factorCompositeInputSchema),
  async (c) => {
    return c.json(
      await updateFactorComposite(c.var.userId, c.req.param('compositeId'), c.req.valid('json')),
    );
  },
);

factorCompositeRoute.delete('/composites/:compositeId', async (c) => {
  return c.json(await deleteFactorComposite(c.var.userId, c.req.param('compositeId')));
});

factorCompositeRoute.post('/composites/:compositeId/copy', async (c) => {
  return c.json(await copyFactorComposite(c.var.userId, c.req.param('compositeId')));
});
