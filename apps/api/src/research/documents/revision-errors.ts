export class ResearchCellRevisionConflictError extends Error {
  public constructor(readonly currentCell: { id: string; source: string; revision: number }) {
    super('Research Cell revision changed');
    this.name = 'ResearchCellRevisionConflictError';
  }
}

export class ResearchDocumentContentRevisionConflictError extends Error {
  public constructor(readonly currentContentRevision: number) {
    super('Research document content revision changed during execution');
    this.name = 'ResearchDocumentContentRevisionConflictError';
  }
}
