import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import {
  acceptResearchCellChangeReview,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  rejectResearchCellChangeProposal,
  ResearchCellChangeReviewUnavailableError,
  revertResearchCellChangeReview,
} from './proposals/cell-changes.js';
import {
  ResearchCellChangeAttemptUnavailableError,
  runResearchCellChangeProposalAttempt,
} from './proposals/attempts.js';

import { researchCellChangeReviewError, researchExecutionError } from './route-errors.js';

export const researchProposalRoute = new Hono();

const cellChangeReviewBody = z.strictObject({
  expectedContentRevision: z.number().int().positive(),
});

researchProposalRoute.post('/cell-change-proposals/:proposalId/apply', async (c) => {
  try {
    const result = await applyResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewUnavailableError) {
      return researchCellChangeReviewError(c, error);
    }
    throw error;
  }
});

researchProposalRoute.post('/cell-change-proposals/:proposalId/review', async (c) => {
  try {
    const result = await applyResearchCellChangeProposalForReview(
      c.var.userId,
      c.req.param('proposalId'),
    );
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    if (error instanceof ResearchCellChangeReviewUnavailableError) {
      return researchCellChangeReviewError(c, error);
    }
    throw error;
  }
});

researchProposalRoute.post(
  '/cell-change-proposals/:proposalId/review/accept',
  validateJson(cellChangeReviewBody),
  async (c) => {
    try {
      const result = await acceptResearchCellChangeReview(
        c.var.userId,
        c.req.param('proposalId'),
        c.req.valid('json').expectedContentRevision,
      );
      return result
        ? c.json(result)
        : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
    } catch (error) {
      if (error instanceof ResearchCellChangeReviewUnavailableError) {
        return researchCellChangeReviewError(c, error);
      }
      throw error;
    }
  },
);

researchProposalRoute.post(
  '/cell-change-proposals/:proposalId/review/revert',
  validateJson(cellChangeReviewBody),
  async (c) => {
    try {
      const result = await revertResearchCellChangeReview(
        c.var.userId,
        c.req.param('proposalId'),
        c.req.valid('json').expectedContentRevision,
      );
      return result
        ? c.json(result)
        : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
    } catch (error) {
      if (error instanceof ResearchCellChangeReviewUnavailableError) {
        return researchCellChangeReviewError(c, error);
      }
      throw error;
    }
  },
);

researchProposalRoute.post('/cell-change-proposals/:proposalId/reject', async (c) => {
  const result = await rejectResearchCellChangeProposal(c.var.userId, c.req.param('proposalId'));
  return result
    ? c.json(result)
    : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
});

researchProposalRoute.post('/cell-change-proposals/:proposalId/attempts', async (c) => {
  try {
    const result = await runResearchCellChangeProposalAttempt(
      c.var.userId,
      c.req.param('proposalId'),
    );
    return result
      ? c.json(result)
      : apiError(c, 'NOT_FOUND', m(c, 'researchCellChangeProposalNotFound'));
  } catch (error) {
    const response = researchExecutionError(c, error);
    if (response) {
      return response;
    }
    if (error instanceof ResearchCellChangeAttemptUnavailableError) {
      const messageKey = {
        proposal_not_applied: 'researchCellChangeAttemptProposalNotApplied',
        proposal_revision_unavailable: 'researchCellChangeAttemptRevisionUnavailable',
        document_changed: 'researchCellChangeAttemptDocumentChanged',
        no_executable_cells: 'researchCellChangeAttemptNoExecutableCells',
      } as const;
      return apiError(
        c,
        error.reason === 'document_changed' ? 'CONFLICT' : 'VALIDATION_FAILED',
        m(c, messageKey[error.reason]),
        { reason: error.reason },
      );
    }
    throw error;
  }
});
