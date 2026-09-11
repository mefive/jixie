import { submitResearchCuratorRun } from './curator/submit.js';
import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import {
  curatorFindingUpdateSchema,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  updateResearchCuratorFindingFeedback,
} from './curator/runs.js';

export const researchCuratorRoute = new Hono();

researchCuratorRoute.post('/curator/runs', async (c) =>
  c.json(await submitResearchCuratorRun(c.var.userId)),
);

researchCuratorRoute.get('/curator/runs/latest', async (c) =>
  c.json(await getLatestResearchCuratorRun(c.var.userId)),
);

researchCuratorRoute.get('/curator/runs/:runId', async (c) => {
  const run = await getResearchCuratorRun(c.var.userId, c.req.param('runId'));
  return run ? c.json(run) : apiError(c, 'NOT_FOUND', m(c, 'researchCuratorRunNotFound'));
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
    return finding
      ? c.json(finding)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCuratorFindingNotFound'));
  },
);
