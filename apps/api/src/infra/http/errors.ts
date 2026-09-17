import { t } from '#i18n/index.js';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodSchema } from 'zod';
import { BusinessError, errorMessage, type BusinessErrorCategory } from '../errors.js';
import { localeFromRequest } from './locale.js';

// Unified error shape for all HTTP routes: { error: { code, message, details? } }
// - code:    machine-readable, the frontend dispatches on it (toast / highlight field / redirect)
// - message: human-readable, can be shown directly
// - details: optional extra info (zod issues, field names, etc.)
export type ErrorCode =
  | 'VALIDATION_FAILED' // malformed input (zod validation failed) / business-rule validation failed
  | 'NOT_FOUND' // resource addressed by the URL does not exist
  | 'CONFLICT' // resource exists but its current state rejects this mutation
  | 'UNAUTHORIZED' // not logged in / session expired / cookie missing
  | 'FORBIDDEN' // logged in but not permitted (account disabled)
  | 'MAINTENANCE' // market data is being updated or awaiting a safe retry
  | 'SERVICE_UNAVAILABLE' // upstream dependency temporarily unavailable (email service, etc.)
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

const STATUS_FOR: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  MAINTENANCE: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const CODE_FOR_CATEGORY = {
  invalid: 'VALIDATION_FAILED',
  missing: 'NOT_FOUND',
  conflict: 'CONFLICT',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  unavailable: 'SERVICE_UNAVAILABLE',
  maintenance: 'MAINTENANCE',
} as const satisfies Record<BusinessErrorCategory, ErrorCode>;

export function handleApiError(error: Error, context: Context) {
  if (error instanceof HTTPException && error.status === 400) {
    return apiError(context, 'VALIDATION_FAILED', t(localeFromRequest(context), 'invalidInput'));
  }
  if (error instanceof BusinessError) {
    return apiError(
      context,
      CODE_FOR_CATEGORY[error.category],
      errorMessage(error, localeFromRequest(context)),
      error.details,
    );
  }

  console.error('[api] Unhandled request error', error);
  return apiError(context, 'INTERNAL_ERROR', t(localeFromRequest(context), 'internalError'));
}

export function apiError(c: Context, code: ErrorCode, message: string, details?: unknown) {
  const body: ApiErrorBody = {
    error: { code, message, ...(details !== undefined && { details }) },
  };
  return c.json(body, STATUS_FOR[code]);
}

// Wrap zValidator so its default { success:false, error:ZodError } is also collapsed into
// ApiErrorBody, giving every error in the routes (zod / business) a uniform shape the frontend
// only has to learn once.
export function validateJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', t(localeFromRequest(c), 'invalidInput'), {
        issues: result.error.issues,
      });
    }
  });
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', t(localeFromRequest(c), 'invalidInput'), {
        issues: result.error.issues,
      });
    }
  });
}

export function validateParam<T extends ZodSchema>(schema: T) {
  return zValidator('param', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', t(localeFromRequest(c), 'invalidInput'), {
        issues: result.error.issues,
      });
    }
  });
}
