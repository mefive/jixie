import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { runResearchCellChangeProposalAttempt } from '../proposals/attempts.js';
import {
  acceptResearchCellChangeReview,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  rejectResearchCellChangeProposal,
  revertResearchCellChangeReview,
} from '../proposals/cell-changes.js';
import { cellChangeReviewSchema } from '@jixie/shared/api/research';

export const researchProposalRoute = new Hono();

researchProposalRoute.post('/cell-change-proposals/:proposalId/apply', async (c) => {
  const result = await applyResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return c.json(result);
});

researchProposalRoute.post('/cell-change-proposals/:proposalId/review', async (c) => {
  const result = await applyResearchCellChangeProposalForReview(
    c.var.userId,
    c.req.param('proposalId'),
  );
  return c.json(result);
});

researchProposalRoute.post(
  '/cell-change-proposals/:proposalId/review/accept',
  validateJson(cellChangeReviewSchema),
  async (c) => {
    const result = await acceptResearchCellChangeReview(
      c.var.userId,
      c.req.param('proposalId'),
      c.req.valid('json').expectedContentRevision,
    );
    return c.json(result);
  },
);

researchProposalRoute.post(
  '/cell-change-proposals/:proposalId/review/revert',
  validateJson(cellChangeReviewSchema),
  async (c) => {
    const result = await revertResearchCellChangeReview(
      c.var.userId,
      c.req.param('proposalId'),
      c.req.valid('json').expectedContentRevision,
    );
    return c.json(result);
  },
);

researchProposalRoute.post('/cell-change-proposals/:proposalId/reject', async (c) => {
  const result = await rejectResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return c.json(result);
});

researchProposalRoute.post('/cell-change-proposals/:proposalId/attempts', async (c) => {
  const result = await runResearchCellChangeProposalAttempt(
    c.var.userId,
    c.req.param('proposalId'),
  );
  return c.json(result);
});
