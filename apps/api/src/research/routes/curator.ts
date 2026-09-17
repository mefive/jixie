import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { updateResearchCuratorFindingFeedback } from '../curator/feedback.js';
import { getLatestResearchCuratorRun, getResearchCuratorRun } from '../curator/read.js';
import { submitResearchCuratorRun } from '../curator/submit.js';
import { curatorFindingUpdateSchema } from '@jixie/shared/api/research';

export const researchCuratorRoute = new Hono();

researchCuratorRoute.post('/curator/runs', async (c) =>
  c.json(await submitResearchCuratorRun(c.var.userId)),
);

researchCuratorRoute.get('/curator/runs/latest', async (c) =>
  c.json(await getLatestResearchCuratorRun(c.var.userId)),
);

researchCuratorRoute.get('/curator/runs/:runId', async (c) => {
  const run = await getResearchCuratorRun(c.var.userId, c.req.param('runId'));
  return c.json(run);
});

researchCuratorRoute.patch(
  '/curator/findings/:findingId',
  validateJson(curatorFindingUpdateSchema),
  async (c) => {
    const input = c.req.valid('json');
    const finding = await updateResearchCuratorFindingFeedback(
      c.var.userId,
      c.req.param('findingId'),
      input,
    );
    return c.json(finding);
  },
);
