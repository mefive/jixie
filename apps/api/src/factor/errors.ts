export type FactorOperationFailure = 'missing' | 'invalid' | 'conflict' | 'unavailable';

/** Business rejection; the route adapter determines its HTTP representation. */
export class FactorOperationError extends Error {
  constructor(
    readonly category: FactorOperationFailure,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'FactorOperationError';
  }
}

export function failFactorOperation(
  category: FactorOperationFailure,
  message: string,
  details?: unknown,
): never {
  throw new FactorOperationError(category, message, details);
}

export type FactorPublicationErrorReason =
  | 'not_found'
  | 'not_draft'
  | 'report_invalid'
  | 'report_outdated';

export class FactorPublicationError extends Error {
  constructor(readonly reason: FactorPublicationErrorReason) {
    super(reason);
    this.name = 'FactorPublicationError';
  }
}
