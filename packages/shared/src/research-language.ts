/** Zero-based source position used by the Research Python language service. */
export interface ResearchLanguagePositionV1 {
  line: number;
  character: number;
}

export interface ResearchLanguageRangeV1 {
  start: ResearchLanguagePositionV1;
  end: ResearchLanguagePositionV1;
}

export interface ResearchLanguageCellV1 {
  id: string;
  source: string;
}

export type ResearchLanguageActionV1 =
  | 'completion'
  | 'hover'
  | 'signature_help'
  | 'definition'
  | 'references'
  | 'prepare_rename'
  | 'rename'
  | 'diagnostics';

export interface ResearchLanguageRequestV1 {
  version: 1;
  documentId: string;
  cells: ResearchLanguageCellV1[];
  cellId: string;
  action: ResearchLanguageActionV1;
  position?: ResearchLanguagePositionV1;
  newName?: string;
}

export interface ResearchLanguageTextEditV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
  newText: string;
}

export interface ResearchLanguageCompletionItemV1 {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: 1 | 2;
  textEdit?: ResearchLanguageTextEditV1;
  additionalTextEdits?: ResearchLanguageTextEditV1[];
}

export interface ResearchLanguageCompletionResultV1 {
  items: ResearchLanguageCompletionItemV1[];
  incomplete: boolean;
}

export interface ResearchLanguageHoverV1 {
  markdown: string;
  range?: ResearchLanguageRangeV1;
}

export interface ResearchLanguageSignatureParameterV1 {
  label: string | [number, number];
  documentation?: string;
}

export interface ResearchLanguageSignatureV1 {
  label: string;
  documentation?: string;
  parameters: ResearchLanguageSignatureParameterV1[];
}

export interface ResearchLanguageSignatureHelpV1 {
  signatures: ResearchLanguageSignatureV1[];
  activeSignature: number;
  activeParameter: number;
}

export interface ResearchLanguageLocationV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
}

export interface ResearchLanguageRenamePreparationV1 {
  range: ResearchLanguageRangeV1;
  placeholder?: string;
}

export interface ResearchLanguageDiagnosticV1 {
  cellId: string;
  range: ResearchLanguageRangeV1;
  severity: 1 | 2 | 3 | 4;
  message: string;
  code?: string | number;
  source?: string;
}

export type ResearchLanguageResultV1 =
  | { version: 1; action: 'completion'; result: ResearchLanguageCompletionResultV1 }
  | { version: 1; action: 'hover'; result: ResearchLanguageHoverV1 | null }
  | { version: 1; action: 'signature_help'; result: ResearchLanguageSignatureHelpV1 | null }
  | { version: 1; action: 'definition'; result: ResearchLanguageLocationV1[] }
  | { version: 1; action: 'references'; result: ResearchLanguageLocationV1[] }
  | {
      version: 1;
      action: 'prepare_rename';
      result: ResearchLanguageRenamePreparationV1 | null;
    }
  | { version: 1; action: 'rename'; result: ResearchLanguageTextEditV1[] }
  | { version: 1; action: 'diagnostics'; result: ResearchLanguageDiagnosticV1[] };
