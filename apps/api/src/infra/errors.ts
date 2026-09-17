import { t, type MessageKey } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';

export type BusinessErrorCategory =
  | 'invalid'
  | 'missing'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'maintenance';

export interface BusinessErrorDefinition {
  category: BusinessErrorCategory;
  messageKey: MessageKey;
  details?: unknown;
}

export interface BusinessErrorOptions {
  params?: Record<string, string | number>;
  details?: unknown;
  cause?: unknown;
}

/** A known business rejection. Transport status and serialization belong to the caller. */
export class BusinessError<Reason extends string = string> extends Error {
  readonly category: BusinessErrorCategory;
  readonly messageKey: MessageKey;
  readonly params: BusinessErrorOptions['params'];
  readonly details: unknown;

  constructor(
    readonly reason: Reason,
    definition: BusinessErrorDefinition,
    options: BusinessErrorOptions = {},
  ) {
    super(t('en', definition.messageKey, options.params), { cause: options.cause });
    this.name = new.target.name;
    this.category = definition.category;
    this.messageKey = definition.messageKey;
    this.params = options.params;
    this.details = options.details ?? definition.details;
  }
}

/** Format at HTTP, CLI, Agent or job output boundaries; never classify errors by their message. */
export function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof BusinessError) {
    return t(locale, error.messageKey, error.params);
  }
  return error instanceof Error ? error.message : String(error);
}

/** Diagnostics produced while compiling or executing user-authored code. */
export class UserCodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserCodeError';
  }
}
