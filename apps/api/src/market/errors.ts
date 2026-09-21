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
