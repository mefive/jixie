import type { ResearchEmbeddedErrorCodeV1 } from '@jixie/shared';

export class ResearchEmbeddedError extends Error {
  constructor(
    readonly code: ResearchEmbeddedErrorCodeV1,
    detail?: string,
  ) {
    super(detail ?? `Embedded analysis: ${code}`);
    this.name = 'ResearchEmbeddedError';
  }
}
