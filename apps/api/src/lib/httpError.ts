import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';

// Unified error shape for auth-related routes: { error: { code, message, details? } }
// - code:    machine-readable, the frontend dispatches on it (toast / highlight field / redirect)
// - message: human-readable, can be shown directly
// - details: optional extra info (zod issues, field names, etc.)
export type ErrorCode =
  | 'VALIDATION_FAILED' // malformed input (zod validation failed) / business-rule validation failed
  | 'NOT_FOUND' // resource addressed by the URL does not exist
  | 'UNAUTHORIZED' // not logged in / session expired / cookie missing
  | 'FORBIDDEN' // logged in but not permitted (account disabled)
  | 'SERVICE_UNAVAILABLE'; // upstream dependency temporarily unavailable (email service, etc.)

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
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  SERVICE_UNAVAILABLE: 503,
};

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
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}

export function validateParam<T extends ZodSchema>(schema: T) {
  return zValidator('param', schema, (result, c) => {
    if (!result.success) {
      return apiError(c, 'VALIDATION_FAILED', '入参不合法', { issues: result.error.issues });
    }
  });
}
