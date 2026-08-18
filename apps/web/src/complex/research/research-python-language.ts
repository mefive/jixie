import type {
  ResearchLanguageActionV1,
  ResearchLanguageCellV1,
  ResearchLanguageCompletionItemV1,
  ResearchLanguageDiagnosticV1,
  ResearchLanguagePositionV1,
  ResearchLanguageRangeV1,
  ResearchLanguageRequestV1,
  ResearchLanguageResultV1,
} from '@jixie/shared';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoTypes from 'monaco-editor';
import { requestResearchLanguage } from '@src/api/client';

interface ResearchPythonModelContext {
  documentId: string;
  cellId: string;
  model: MonacoTypes.editor.ITextModel;
  editor: MonacoTypes.editor.IStandaloneCodeEditor;
  getCells: () => readonly ResearchLanguageCellV1[];
}

interface DiagnosticState {
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  generation: number;
}

const modelContexts = new Map<string, ResearchPythonModelContext>();
const diagnosticStates = new Map<string, DiagnosticState>();
let languageInstalled = false;

export function researchPythonModelUri(
  monacoInstance: Monaco,
  documentId: string,
  cellId: string,
): MonacoTypes.Uri {
  return monacoInstance.Uri.parse(
    `file:///research/${encodeURIComponent(documentId)}/${encodeURIComponent(cellId)}.py`,
  );
}

export function installResearchPythonLanguage(monacoInstance: Monaco): void {
  if (languageInstalled) {
    return;
  }
  languageInstalled = true;

  monacoInstance.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    async provideCompletionItems(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      _context: MonacoTypes.languages.CompletionContext,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'completion',
        toLanguagePosition(position),
        token,
      );
      if (response?.action !== 'completion') {
        return { suggestions: [] as MonacoTypes.languages.CompletionItem[] };
      }
      return {
        incomplete: response.result.incomplete,
        suggestions: response.result.items.map((item) =>
          toCompletionItem(monacoInstance, model, position, item),
        ),
      };
    },
  });

  monacoInstance.languages.registerHoverProvider('python', {
    async provideHover(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(model, 'hover', toLanguagePosition(position), token);
      if (response?.action !== 'hover' || !response.result) {
        return null;
      }
      return {
        contents: [{ value: response.result.markdown }],
        ...(response.result.range
          ? { range: toMonacoRange(monacoInstance, response.result.range) }
          : {}),
      };
    },
  });

  monacoInstance.languages.registerSignatureHelpProvider('python', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'signature_help',
        toLanguagePosition(position),
        token,
      );
      if (response?.action !== 'signature_help' || !response.result) {
        return null;
      }
      return {
        value: {
          activeSignature: response.result.activeSignature,
          activeParameter: response.result.activeParameter,
          signatures: response.result.signatures.map((signature) => ({
            label: signature.label,
            ...(signature.documentation ? { documentation: signature.documentation } : {}),
            parameters: signature.parameters.map((parameter) => ({
              label: parameter.label,
              ...(parameter.documentation ? { documentation: parameter.documentation } : {}),
            })),
          })),
        },
        dispose() {},
      };
    },
  });

  monacoInstance.languages.registerDefinitionProvider('python', {
    async provideDefinition(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'definition',
        toLanguagePosition(position),
        token,
      );
      if (response?.action !== 'definition') {
        return [];
      }
      const context = modelContexts.get(model.uri.toString());
      if (!context) {
        return [];
      }
      return response.result.map((location) => ({
        uri: researchPythonModelUri(monacoInstance, context.documentId, location.cellId),
        range: toMonacoRange(monacoInstance, location.range),
      }));
    },
  });

  monacoInstance.languages.registerReferenceProvider('python', {
    async provideReferences(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      _context: MonacoTypes.languages.ReferenceContext,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'references',
        toLanguagePosition(position),
        token,
      );
      if (response?.action !== 'references') {
        return [];
      }
      const modelContext = modelContexts.get(model.uri.toString());
      if (!modelContext) {
        return [];
      }
      return response.result.map((location) => ({
        uri: researchPythonModelUri(monacoInstance, modelContext.documentId, location.cellId),
        range: toMonacoRange(monacoInstance, location.range),
      }));
    },
  });

  monacoInstance.languages.registerRenameProvider('python', {
    async resolveRenameLocation(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'prepare_rename',
        toLanguagePosition(position),
        token,
      );
      if (response?.action !== 'prepare_rename' || !response.result) {
        return {
          range: wordRange(monacoInstance, model, position),
          text: '',
          rejectReason: 'Symbol cannot be renamed',
        };
      }
      return {
        range: toMonacoRange(monacoInstance, response.result.range),
        text:
          response.result.placeholder ??
          model.getValueInRange(toMonacoRange(monacoInstance, response.result.range)),
      };
    },
    async provideRenameEdits(
      model: MonacoTypes.editor.ITextModel,
      position: MonacoTypes.Position,
      newName: string,
      token: MonacoTypes.CancellationToken,
    ) {
      const response = await languageRequest(
        model,
        'rename',
        toLanguagePosition(position),
        token,
        newName,
      );
      if (response?.action !== 'rename') {
        return {
          edits: [] as MonacoTypes.languages.IWorkspaceTextEdit[],
          rejectReason: 'Rename failed',
        };
      }
      const context = modelContexts.get(model.uri.toString());
      if (!context) {
        return {
          edits: [] as MonacoTypes.languages.IWorkspaceTextEdit[],
          rejectReason: 'Research document is not available',
        };
      }
      return {
        edits: response.result.map((edit) => {
          const resource = researchPythonModelUri(monacoInstance, context.documentId, edit.cellId);
          return {
            resource,
            textEdit: {
              range: toMonacoRange(monacoInstance, edit.range),
              text: edit.newText,
            },
            versionId: monacoInstance.editor.getModel(resource)?.getVersionId(),
          };
        }),
      };
    },
  });

  monacoInstance.editor.registerEditorOpener({
    openCodeEditor(
      _source: MonacoTypes.editor.ICodeEditor,
      resource: MonacoTypes.Uri,
      selectionOrPosition?: MonacoTypes.IRange | MonacoTypes.IPosition,
    ) {
      const target = modelContexts.get(resource.toString());
      if (!target) {
        return false;
      }
      target.editor.getDomNode()?.closest('[data-cell-id]')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
      const position = selectionOrPosition
        ? 'startLineNumber' in selectionOrPosition
          ? {
              lineNumber: selectionOrPosition.startLineNumber,
              column: selectionOrPosition.startColumn,
            }
          : selectionOrPosition
        : undefined;
      if (position) {
        target.editor.setPosition(position);
        target.editor.revealPositionInCenter(position);
      }
      target.editor.focus();
      return true;
    },
  });
}

export function attachResearchPythonModel(
  monacoInstance: Monaco,
  context: ResearchPythonModelContext,
): MonacoTypes.IDisposable {
  const uri = context.model.uri.toString();
  modelContexts.set(uri, context);
  scheduleDiagnostics(monacoInstance, context.documentId, 80);
  const modelChange = context.model.onDidChangeContent(() =>
    scheduleDiagnostics(monacoInstance, context.documentId),
  );
  return {
    dispose() {
      modelChange.dispose();
      modelContexts.delete(uri);
      monacoInstance.editor.setModelMarkers(context.model, 'pyright', []);
      if (
        ![...modelContexts.values()].some(
          (candidate) => candidate.documentId === context.documentId,
        )
      ) {
        const state = diagnosticStates.get(context.documentId);
        if (state?.timer) {
          clearTimeout(state.timer);
        }
        state?.controller?.abort();
        diagnosticStates.delete(context.documentId);
      }
    },
  };
}

function scheduleDiagnostics(monacoInstance: Monaco, documentId: string, delay = 450): void {
  const state = diagnosticStates.get(documentId) ?? { generation: 0 };
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.generation += 1;
  const generation = state.generation;
  state.timer = setTimeout(() => {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    void requestDocumentDiagnostics(documentId, controller.signal).then((diagnostics) => {
      if (!diagnostics || state.generation !== generation) {
        return;
      }
      applyDiagnostics(monacoInstance, documentId, diagnostics);
    });
  }, delay);
  diagnosticStates.set(documentId, state);
}

async function requestDocumentDiagnostics(
  documentId: string,
  signal: AbortSignal,
): Promise<ResearchLanguageDiagnosticV1[] | null> {
  const context = [...modelContexts.values()].find(
    (candidate) => candidate.documentId === documentId,
  );
  if (!context) {
    return null;
  }
  const request = makeLanguageRequest(context, 'diagnostics');
  try {
    const response = await requestResearchLanguage(request, signal);
    return response.action === 'diagnostics' ? response.result : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    return null;
  }
}

function applyDiagnostics(
  monacoInstance: Monaco,
  documentId: string,
  diagnostics: ResearchLanguageDiagnosticV1[],
): void {
  const contexts = [...modelContexts.values()].filter(
    (candidate) => candidate.documentId === documentId,
  );
  for (const context of contexts) {
    monacoInstance.editor.setModelMarkers(
      context.model,
      'pyright',
      diagnostics
        .filter((diagnostic) => diagnostic.cellId === context.cellId)
        .map((diagnostic) => ({
          ...toMonacoRange(monacoInstance, diagnostic.range),
          severity: markerSeverity(monacoInstance, diagnostic.severity),
          message: diagnostic.message,
          source: diagnostic.source ?? 'Pyright',
          ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {}),
        })),
    );
  }
}

async function languageRequest(
  model: MonacoTypes.editor.ITextModel,
  action: Exclude<ResearchLanguageActionV1, 'diagnostics'>,
  position: ResearchLanguagePositionV1,
  token: MonacoTypes.CancellationToken,
  newName?: string,
): Promise<ResearchLanguageResultV1 | null> {
  const context = modelContexts.get(model.uri.toString());
  if (!context) {
    return null;
  }
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => controller.abort());
  try {
    return await requestResearchLanguage(
      makeLanguageRequest(context, action, position, newName),
      controller.signal,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    return null;
  } finally {
    cancellation.dispose();
  }
}

function makeLanguageRequest(
  context: ResearchPythonModelContext,
  action: ResearchLanguageActionV1,
  position?: ResearchLanguagePositionV1,
  newName?: string,
): ResearchLanguageRequestV1 {
  return {
    version: 1,
    documentId: context.documentId,
    cells: collectDocumentCells(context),
    cellId: context.cellId,
    action,
    ...(position ? { position } : {}),
    ...(newName ? { newName } : {}),
  };
}

function collectDocumentCells(context: ResearchPythonModelContext): ResearchLanguageCellV1[] {
  return context.getCells().map((cell) => {
    const live = [...modelContexts.values()].find(
      (candidate) => candidate.documentId === context.documentId && candidate.cellId === cell.id,
    );
    return { id: cell.id, source: live?.model.getValue() ?? cell.source };
  });
}

function toCompletionItem(
  monacoInstance: Monaco,
  model: MonacoTypes.editor.ITextModel,
  position: MonacoTypes.Position,
  item: ResearchLanguageCompletionItemV1,
): MonacoTypes.languages.CompletionItem {
  const range =
    item.textEdit && item.textEdit.cellId === modelContexts.get(model.uri.toString())?.cellId
      ? toMonacoRange(monacoInstance, item.textEdit.range)
      : wordRange(monacoInstance, model, position);
  const additionalTextEdits = item.additionalTextEdits
    ?.filter((edit) => edit.cellId === modelContexts.get(model.uri.toString())?.cellId)
    .map((edit) => ({ range: toMonacoRange(monacoInstance, edit.range), text: edit.newText }));
  return {
    label: item.label,
    kind: completionKind(monacoInstance, item.kind),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.documentation ? { documentation: { value: item.documentation } } : {}),
    ...(item.sortText ? { sortText: `5_${item.sortText}` } : {}),
    ...(item.filterText ? { filterText: item.filterText } : {}),
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    insertTextRules:
      item.insertTextFormat === 2
        ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : monacoInstance.languages.CompletionItemInsertTextRule.None,
    range,
    ...(additionalTextEdits && additionalTextEdits.length > 0 ? { additionalTextEdits } : {}),
  };
}

function completionKind(
  monacoInstance: Monaco,
  lspKind?: number,
): MonacoTypes.languages.CompletionItemKind {
  const kinds = monacoInstance.languages.CompletionItemKind;
  const mapping: Record<number, MonacoTypes.languages.CompletionItemKind> = {
    1: kinds.Text,
    2: kinds.Method,
    3: kinds.Function,
    4: kinds.Constructor,
    5: kinds.Field,
    6: kinds.Variable,
    7: kinds.Class,
    8: kinds.Interface,
    9: kinds.Module,
    10: kinds.Property,
    11: kinds.Unit,
    12: kinds.Value,
    13: kinds.Enum,
    14: kinds.Keyword,
    15: kinds.Snippet,
    16: kinds.Color,
    17: kinds.File,
    18: kinds.Reference,
    19: kinds.Folder,
    20: kinds.EnumMember,
    21: kinds.Constant,
    22: kinds.Struct,
    23: kinds.Event,
    24: kinds.Operator,
    25: kinds.TypeParameter,
  };
  return mapping[lspKind ?? 0] ?? kinds.Text;
}

function markerSeverity(
  monacoInstance: Monaco,
  severity: 1 | 2 | 3 | 4,
): MonacoTypes.MarkerSeverity {
  switch (severity) {
    case 1:
      return monacoInstance.MarkerSeverity.Error;
    case 2:
      return monacoInstance.MarkerSeverity.Warning;
    case 3:
      return monacoInstance.MarkerSeverity.Info;
    case 4:
      return monacoInstance.MarkerSeverity.Hint;
  }
}

function toLanguagePosition(position: MonacoTypes.Position): ResearchLanguagePositionV1 {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function toMonacoRange(monacoInstance: Monaco, range: ResearchLanguageRangeV1): MonacoTypes.Range {
  return new monacoInstance.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function wordRange(
  monacoInstance: Monaco,
  model: MonacoTypes.editor.ITextModel,
  position: MonacoTypes.Position,
): MonacoTypes.Range {
  const word = model.getWordUntilPosition(position);
  return new monacoInstance.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}
