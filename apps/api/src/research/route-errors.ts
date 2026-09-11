import { ResearchDocumentRunInProgressError } from './execution/run-state.js';
import { ResearchCellChangeReviewOpenError } from './proposals/review-state.js';
import { ResearchCellDependencyBlockedError } from './dependencies/runnable.js';
import type { Context } from 'hono';
import { apiError } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import type { ResearchCellChangeReviewUnavailableError } from './proposals/cell-changes.js';

export function researchCellChangeReviewError(
  c: Context,
  error: ResearchCellChangeReviewUnavailableError,
) {
  const messageKey = {
    delete_requires_explicit_application: 'researchCellChangeReviewDeleteRequiresApplication',
    review_not_open: 'researchCellChangeReviewNotOpen',
    review_already_open: 'researchCellChangeReviewAlreadyOpen',
    document_running: 'researchDocumentRunInProgress',
    document_changed: 'researchCellChangeReviewDocumentChanged',
  } as const;
  return apiError(
    c,
    error.reason === 'document_changed' || error.reason === 'document_running'
      ? 'CONFLICT'
      : 'VALIDATION_FAILED',
    m(c, messageKey[error.reason]),
    { reason: error.reason },
  );
}

export function researchExecutionError(c: Context, error: unknown) {
  if (error instanceof ResearchCellChangeReviewOpenError) {
    return apiError(c, 'CONFLICT', m(c, 'researchCellChangeReviewMustResolve'));
  }
  if (error instanceof ResearchDocumentRunInProgressError) {
    return apiError(c, 'CONFLICT', m(c, 'researchDocumentRunInProgress'));
  }
  if (error instanceof ResearchCellDependencyBlockedError) {
    return apiError(c, 'VALIDATION_FAILED', m(c, 'researchCellDependencyBlocked'), {
      cellIds: error.cellIds,
    });
  }
  return null;
}
