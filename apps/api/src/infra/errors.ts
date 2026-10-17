import { t, type MessageKey } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';

/**
 * 限定稳定业务错误分类，供 HTTP、CLI 与 Agent 输出边界映射。
 * Define stable business-error categories for HTTP, CLI and agent output mapping.
 */
export type BusinessErrorCategory =
  | 'invalid'
  | 'missing'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'maintenance';

/**
 * 定义业务错误的分类、翻译键及默认说明，供领域错误共用。
 * Define business-error classification and translation metadata reused by domain errors.
 */
export interface BusinessErrorDefinition {
  category: BusinessErrorCategory;
  messageKey: MessageKey;
  details?: unknown;
}

/**
 * 提供业务异常的公开详情、翻译参数与内部原因，避免输出边界猜测文案。
 * Supply public details, translation parameters and an internal cause for a business error.
 */
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

/**
 * 仅在 HTTP、CLI、Agent 或 Job 输出边界翻译错误，不根据错误文案判断分类。
 * Format at HTTP, CLI, Agent or job output boundaries; never classify errors by their message.
 */
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
