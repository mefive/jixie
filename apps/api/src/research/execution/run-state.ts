export interface ResearchDocumentRunControl {
  documentId: string;
  interrupted: boolean;
  settled: Promise<void>;
  settle: () => void;
}

const activeResearchDocumentRuns = new Map<string, ResearchDocumentRunControl>();

export class ResearchDocumentRunInProgressError extends Error {
  public constructor() {
    super('Research document already has an active run');
    this.name = 'ResearchDocumentRunInProgressError';
  }
}

export function isResearchDocumentRunActive(documentId: string): boolean {
  return activeResearchDocumentRuns.has(documentId);
}

export function startResearchDocumentRun(documentId: string): ResearchDocumentRunControl {
  if (activeResearchDocumentRuns.has(documentId)) {
    throw new ResearchDocumentRunInProgressError();
  }

  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const control = { documentId, interrupted: false, settled, settle };
  activeResearchDocumentRuns.set(documentId, control);
  return control;
}

export function finishResearchDocumentRun(control: ResearchDocumentRunControl): void {
  if (activeResearchDocumentRuns.get(control.documentId) === control) {
    activeResearchDocumentRuns.delete(control.documentId);
  }
  control.settle();
}

export function getResearchDocumentRun(documentId: string): ResearchDocumentRunControl | undefined {
  return activeResearchDocumentRuns.get(documentId);
}
