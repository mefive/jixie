import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
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

/** 数据获取的传输失败，与字段映射或计算错误分开。 / A source transport failure, distinct from mapping or computation errors. */
export class MarketSourceDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MarketSourceDownloadError';
  }
}

/** 只按已知错误类型保留下载断点，不匹配错误文案。 / Retain download checkpoints by known error types, never message matching. */
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
