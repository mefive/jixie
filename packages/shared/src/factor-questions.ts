import type { ChatMessage } from './chat.js';
import type { FactorReportSummary } from './factor.js';

/** The exact saved definition and bounded report summary supplied to one question turn. */
export interface FactorQuestionContextV1 {
  version: 1;
  capturedAt: string;
  factor: {
    key: string;
    name: string;
    kind: 'factor' | 'composite' | 'template';
    analysisKind: string;
    language: string;
    source: string;
    sourceHash: string;
  };
  report: {
    id: string;
    contentHash: string;
    summary: FactorReportSummary;
    factorCodeSnapshot: string | null;
    factorCodeHash: string | null;
    dataRevision: string | null;
  } | null;
}

export interface FactorQuestionInputV1 {
  dataReferences?: import('./research-embedded.js').ResearchDataReferenceV1[];
  factorKey: string;
  message: string;
  reportId?: string;
}

export interface FactorQuestionTurnV1 {
  conversationId: string;
  turnId: string;
  message: ChatMessage;
}

export interface FactorQuestionHistoryV1 {
  conversationId: string | null;
  messages: ChatMessage[];
  nextBefore: number | null;
  activeTurnId: string | null;
}
