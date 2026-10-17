import { ResearchError } from '../errors.js';

/**
 * 维护文档活动执行和取消状态，供所有 Cell 共享控制。
 *
 * Share active-run and interruption state across a document's cells.
 */
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
