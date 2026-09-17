import {
  BusinessError,
  type BusinessErrorDefinition,
  type BusinessErrorOptions,
} from '#infra/errors.js';

const definitions = {
  strategy_not_found: {
    category: 'missing',
    messageKey: 'strategyNotFound',
  },
} as const satisfies Record<string, BusinessErrorDefinition>;

export type SharingErrorReason = keyof typeof definitions;

export class SharingError extends BusinessError<SharingErrorReason> {
  constructor(reason: SharingErrorReason, options: BusinessErrorOptions = {}) {
    super(reason, definitions[reason], options);
  }
}
