import { ResearchError } from '../errors.js';
export interface ResearchDocumentRunControl {
  documentId: string;
  interrupted: boolean;
  settled: Promise<void>;
  settle: () => void;
}

const activeResearchDocumentRuns = new Map<string, ResearchDocumentRunControl>();

export function isResearchDocumentRunActive(documentId: string): boolean {
  return activeResearchDocumentRuns.has(documentId);
}

export function startResearchDocumentRun(documentId: string): ResearchDocumentRunControl {
  if (activeResearchDocumentRuns.has(documentId)) {
    throw new ResearchError('document_run_in_progress');
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
