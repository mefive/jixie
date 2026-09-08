import type { Context } from 'hono';
import { t, type MessageKey } from '../../i18n/index.js';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@jixie/shared';

// Resolve the request locale from the Accept-Language header the web client sends ('zh' | 'en').
// Only the primary subtag's first two letters matter here; anything unrecognized falls back to default.
export function localeFromRequest(c: Context): Locale {
  const header = c.req.header('accept-language') ?? '';
  const primary = header.split(',')[0]?.trim().slice(0, 2).toLowerCase();
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}

// Render a message using the request locale at the HTTP boundary.
export function m(
  context: Context,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(localeFromRequest(context), key, params);
}
