import type { Context } from 'hono';
import { apiError } from '../infra/http/errors.js';
import { StrategyOperationError } from './operation-errors.js';

export function strategyOperationApiError(context: Context, error: unknown) {
  if (!(error instanceof StrategyOperationError)) {
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
