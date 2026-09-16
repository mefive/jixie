export type StrategyOperationFailure = 'missing' | 'invalid' | 'conflict' | 'unavailable';

/** Business rejection; the route adapter determines its HTTP representation. */
export class StrategyOperationError extends Error {
  constructor(
    readonly category: StrategyOperationFailure,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StrategyOperationError';
  }
}

export function failStrategyOperation(
  category: StrategyOperationFailure,
  message: string,
  details?: unknown,
): never {
  throw new StrategyOperationError(category, message, details);
}
