import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  repair_price_range: { category: 'invalid', messageKey: 'repairPriceRange' },
  repair_price_change: { category: 'invalid', messageKey: 'repairPriceChange' },
  repair_dividend_kind: { category: 'invalid', messageKey: 'repairDividendKind' },
  repair_dividend_dates: { category: 'invalid', messageKey: 'repairDividendDates' },
  repair_dividend_ratio: { category: 'invalid', messageKey: 'repairDividendRatio' },
  repair_target_changed: { category: 'conflict', messageKey: 'repairTargetChanged' },
  repair_security: { category: 'invalid', messageKey: 'repairSecurity' },
  repair_dividend_identity: { category: 'conflict', messageKey: 'repairDividendIdentity' },
  ambiguous_dividend_event: { category: 'conflict', messageKey: 'ambiguousDividendEvent' },
  inputs_not_ready: { category: 'unavailable', messageKey: 'marketInputsNotReady' },
  no_data: {
    category: 'missing',
    messageKey: 'noDataInRange',
  },
  unsupported_instrument_type: {
    category: 'invalid',
    messageKey: 'unsupportedInstrumentType',
  },
  start_after_end: {
    category: 'invalid',
    messageKey: 'startAfterEnd',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type MarketErrorReason = keyof typeof definitions;

export class MarketError extends BusinessError<MarketErrorReason> {
  constructor(reason: MarketErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}

export class MacroRegimeInsufficientHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacroRegimeInsufficientHistoryError';
  }
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class TushareError extends Error {
  constructor(
    readonly apiName: string,
    readonly code: number,
    readonly apiMsg: string,
  ) {
    super(`[tushare:${apiName}] code=${code}: ${apiMsg}`);
    this.name = 'TushareError';
  }
}

export class ChinaBondHttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A valid response is incomplete; it does not prove permanent source absence. */
export class MarketSourcePendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketSourcePendingError';
  }
}

/**
 * 数据获取的传输失败，与字段映射或计算错误分开。
 *
 * A source transport failure, distinct from mapping or computation errors.
 */
export class MarketSourceDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MarketSourceDownloadError';
  }
}

/**
 * 只按已知错误类型保留下载断点，不匹配错误文案。
 *
 * Retain download checkpoints by known error types, never message matching.
 */
export function isMarketSourceFailure(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isMarketSourceFailure);
  }

  return (
    error instanceof MarketSourceDownloadError ||
    error instanceof MarketSourcePendingError ||
    error instanceof TushareError ||
    error instanceof HttpStatusError ||
    error instanceof ChinaBondHttpStatusError
  );
}

/**
 * 有限同步预算耗尽应保留待办，不能作为永久来源失败。
 *
 * Exhausted synchronization budgets defer durable work rather than imply permanent source failure.
 */
export class MarketSyncBudgetError extends Error {
  constructor(message = 'Finite synchronization request/time budget reached') {
    super(message);
    this.name = 'MarketSyncBudgetError';
  }
}

/** 来源满页需要缩小日期区间，探测行不入库。 / A saturated source range must narrow; probe rows are not admitted. */
export class MarketSourceRangeLimitError extends Error {
  constructor(readonly receivedCount: number) {
    super('Source date range reached its response limit');
    this.name = 'MarketSourceRangeLimitError';
  }
}
