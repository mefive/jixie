import type { Context } from 'hono';
import { m } from '#infra/http/locale.js';
import type { FactorPublicationError } from './publication/factor.js';
import { apiError } from '#infra/http/errors.js';
import { FactorOperationError } from './operation-errors.js';

export function factorOperationApiError(context: Context, error: unknown) {
  if (!(error instanceof FactorOperationError)) {
    throw error;
  }
  const code = {
    missing: 'NOT_FOUND',
    invalid: 'VALIDATION_FAILED',
    conflict: 'CONFLICT',
    unavailable: 'SERVICE_UNAVAILABLE',
  } as const;
  return apiError(context, code[error.category], error.message, error.details);
}

export function factorPublicationApiError(
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
