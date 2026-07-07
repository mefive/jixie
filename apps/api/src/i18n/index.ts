import type { Context } from 'hono';
import { localeFromRequest } from './locale.js';
import { t, type MessageKey } from './messages.js';

export { localeFromRequest } from './locale.js';
export { t, type MessageKey } from './messages.js';

// Convenience for route handlers: render a user-facing message in the request's locale. Keeps call
// sites terse — `apiError(c, 'NOT_FOUND', m(c, 'strategyNotFound'))`.
export function m(c: Context, key: MessageKey, params?: Record<string, string | number>): string {
  return t(localeFromRequest(c), key, params);
}
