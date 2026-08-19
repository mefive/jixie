import Editor, { DiffEditor, loader, type Monaco } from '@monaco-editor/react';
import {
  RESEARCH_SDK_CONTRACT_V1,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogResultV1,
  type ResearchLanguageCellV1,
  type ResearchSdkFunctionContractV1,
  type ResearchSdkParameterContractV1,
} from '@jixie/shared';
import * as monaco from 'monaco-editor';
import { useRef } from 'react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { localeStore } from '@src/i18n/locale-store';
import { searchResearchDataCatalog } from '@src/api/client';
import {
  researchSdkActiveCall,
  researchSdkCompletionContext,
  researchSdkDataFrameBindings,
  researchSdkHoverContract,
  researchSdkStringArgument,
  type ResearchSdkCompletionContext,
} from './research-sdk-language';
import {
  attachResearchPythonModel,
  installResearchPythonLanguage,
  researchPythonModelUri,
} from './research-python-language';

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'json' ? new jsonWorker() : new editorWorker();
  },
};
loader.config({ monaco });

let researchSdkLanguageInstalled = false;
const researchDataCatalogRequests = new Map<string, Promise<ResearchDataCatalogResultV1>>();

interface ResearchCodeEditorProps {
  documentId: string;
  cellId: string;
  cells: readonly ResearchLanguageCellV1[];
  value: string;
  language: 'python' | 'json';
  onChange: (value: string) => void;
  onRun: () => void;
  onBlur: () => void;
}

interface ResearchCodeDiffEditorProps {
  documentId: string;
  reviewId: string;
  cellId: string;
  cells: readonly ResearchLanguageCellV1[];
  original: string;
  value: string;
  language: 'python' | 'json' | 'markdown';
  onChange: (value: string) => void;
  onRun: () => void;
  onBlur: () => void;
}

/** Lightweight Python/JSON editor for research cells; execution remains server-side and isolated. */
export default function ResearchCodeEditor({
  documentId,
  cellId,
  cells,
  value,
  language,
  onChange,
  onRun,
  onBlur,
}: ResearchCodeEditorProps) {
  const callbacksRef = useRef({ onBlur, onRun });
  callbacksRef.current = { onBlur, onRun };
  const languageContextRef = useRef({ cells });
  languageContextRef.current = { cells };
  const lineCount = value.split('\n').length;
  const height = Math.min(520, Math.max(128, lineCount * 20 + 32));
  return (
    <Editor
      height={height}
      language={language}
      path={
        language === 'python'
          ? researchPythonModelUri(monaco, documentId, cellId).toString()
          : `file:///research/${encodeURIComponent(documentId)}/${encodeURIComponent(cellId)}.json`
      }
      theme="vs"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={(editor, monacoInstance) => {
        installResearchSdkLanguage(monacoInstance);
        installResearchPythonLanguage(monacoInstance);
        if (language === 'python') {
          const binding = attachResearchPythonModel(monacoInstance, {
            documentId,
            cellId,
            model: editor.getModel()!,
            editor,
            getCells: () => languageContextRef.current.cells,
          });
          editor.onDidDispose(() => binding.dispose());
        }
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
          callbacksRef.current.onRun(),
        );
        editor.onDidBlurEditorWidget(() => callbacksRef.current.onBlur());
      }}
      options={{
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'line',
        overviewRulerLanes: 0,
        fixedOverflowWidgets: true,
        wordWrap: 'on',
      }}
    />
  );
}

/** Cursor-style inline review: the original model is immutable and the current Cell stays editable. */
export function ResearchCodeDiffEditor({
  documentId,
  reviewId,
  cellId,
  cells,
  original,
  value,
  language,
  onChange,
  onRun,
  onBlur,
}: ResearchCodeDiffEditorProps) {
  const callbacksRef = useRef({ onBlur, onChange, onRun });
  callbacksRef.current = { onBlur, onChange, onRun };
  const languageContextRef = useRef({ cells });
  languageContextRef.current = { cells };
  const lineCount = Math.max(original.split('\n').length, value.split('\n').length);
  const height = Math.min(620, Math.max(148, lineCount * 20 + 44));
  const extension = language === 'markdown' ? 'md' : language === 'json' ? 'json' : 'py';
  const modifiedModelPath =
    language === 'python'
      ? researchPythonModelUri(monaco, documentId, cellId).toString()
      : `file:///research/${encodeURIComponent(documentId)}/${encodeURIComponent(cellId)}.${extension}`;
  return (
    <DiffEditor
      height={height}
      original={original}
      modified={value}
      originalLanguage={language}
      modifiedLanguage={language}
      originalModelPath={`file:///research-reviews/${encodeURIComponent(reviewId)}/${encodeURIComponent(cellId)}.base.${extension}`}
      modifiedModelPath={modifiedModelPath}
      beforeMount={(monacoInstance) => {
        configureResearchInlineDiffTheme(monacoInstance);
        installResearchSdkLanguage(monacoInstance);
        installResearchPythonLanguage(monacoInstance);
      }}
      theme="jx-research-inline-diff"
      onMount={(editor) => {
        const modifiedEditor = editor.getModifiedEditor();
        const modifiedModel = modifiedEditor.getModel()!;
        modifiedModel.updateOptions({ tabSize: 4, insertSpaces: true });
        const changeSubscription = modifiedEditor.onDidChangeModelContent(() => {
          callbacksRef.current.onChange(modifiedModel.getValue());
        });
        if (language === 'python') {
          const binding = attachResearchPythonModel(monaco, {
            documentId,
            cellId,
            model: modifiedModel,
            editor: modifiedEditor,
            getCells: () => languageContextRef.current.cells,
          });
          modifiedEditor.onDidDispose(() => binding.dispose());
        }
        modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
          callbacksRef.current.onRun(),
        );
        modifiedEditor.onDidBlurEditorWidget(() => callbacksRef.current.onBlur());
        modifiedEditor.onDidDispose(() => changeSubscription.dispose());
      }}
      options={{
        readOnly: false,
        originalEditable: false,
        renderSideBySide: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: 20,
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        renderOverviewRuler: false,
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'line',
        renderIndicators: true,
        renderMarginRevertIcon: false,
        wordWrap: 'on',
        diffWordWrap: 'on',
        fixedOverflowWidgets: true,
      }}
    />
  );
}

function configureResearchInlineDiffTheme(monacoInstance: Monaco): void {
  monacoInstance.editor.defineTheme('jx-research-inline-diff', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1F2933',
      'editor.lineHighlightBackground': '#F7F8FA80',
      'editor.selectionBackground': '#DCE3EB80',
      'editorGutter.background': '#FFFFFF',
      'editorLineNumber.foreground': '#98A2B3',
      'editorLineNumber.activeForeground': '#475467',
      'diffEditor.insertedLineBackground': '#EAF5EEB3',
      'diffEditor.insertedTextBackground': '#CDE8D599',
      'diffEditor.removedLineBackground': '#FCEBECCC',
      'diffEditor.removedTextBackground': '#F5CCCC99',
      'diffEditorGutter.insertedLineBackground': '#EAF5EE',
      'diffEditorGutter.removedLineBackground': '#FCEBEC',
      'diffEditor.border': '#D8DEE6',
      'diffEditor.diagonalFill': '#D8DEE633',
    },
  });
}

// —— Research SDK language support ——

function installResearchSdkLanguage(monacoInstance: Monaco): void {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__researchMonaco = monacoInstance;
  }
  if (researchSdkLanguageInstalled) {
    return;
  }
  researchSdkLanguageInstalled = true;

  monacoInstance.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.', '(', ',', '=', '[', '"', "'"],
    async provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
      if (!isResearchPythonModel(model)) {
        return { suggestions: [] };
      }
      const offset = model.getOffsetAt(position);
      const context = researchSdkCompletionContext(model.getValue(), offset);
      if (!context) {
        return { suggestions: [] };
      }
      const range = completionRange(monacoInstance, position, context.partial);

      switch (context.kind) {
        case 'namespace_member':
          return {
            suggestions: RESEARCH_SDK_CONTRACT_V1.functions
              .filter((contract) => contract.namespace === context.namespace)
              .map((contract) => ({
                label: contract.name,
                kind: monacoInstance.languages.CompletionItemKind.Method,
                detail: researchSdkSignature(contract),
                documentation: localizedDescription(contract),
                insertText: researchSdkSnippet(contract),
                insertTextRules:
                  monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                sortText: `0_${contract.name}`,
              })),
          };
        case 'parameter_name':
          return {
            suggestions: context.contract.parameters
              .filter((parameter) => !context.usedParameters.has(parameter.name))
              .map((parameter) => ({
                label: parameter.name,
                kind: monacoInstance.languages.CompletionItemKind.Property,
                detail: researchSdkParameterType(parameter),
                documentation: localizedDescription(parameter),
                insertText: researchSdkParameterSnippet(parameter),
                insertTextRules:
                  monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                sortText: `${parameter.required ? '0' : '1'}_${parameter.name}`,
              })),
          };
        case 'parameter_value': {
          const parameter = context.contract.parameters.find(
            (candidate) => candidate.name === context.parameterName,
          );
          if (parameter?.type === 'enum') {
            return {
              suggestions: (parameter.values ?? []).map((value) => ({
                label: value,
                kind: monacoInstance.languages.CompletionItemKind.EnumMember,
                detail: localizedDescription(parameter),
                insertText: value,
                range,
              })),
            };
          }
          if (
            parameter &&
            ['x', 'y', 'column', 'value', 'group'].includes(parameter.name) &&
            context.frameVariable
          ) {
            const frameContract = researchSdkDataFrameBindings(model.getValue()).get(
              context.frameVariable,
            );
            return {
              suggestions: researchSdkColumnSuggestions(monacoInstance, frameContract, range),
            };
          }
          if (parameter?.name === 'identifier' || parameter?.name === 'measure') {
            return {
              suggestions: await researchDataCatalogSuggestions(monacoInstance, context, range),
            };
          }
          return { suggestions: [] };
        }
        case 'dataframe_column':
          return {
            suggestions: researchSdkColumnSuggestions(monacoInstance, context.contract, range),
          };
      }
    },
  });

  monacoInstance.languages.registerSignatureHelpProvider('python', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model: monaco.editor.ITextModel, position: monaco.Position) {
      if (!isResearchPythonModel(model)) {
        return null;
      }
      const activeCall = researchSdkActiveCall(model.getValue(), model.getOffsetAt(position));
      if (!activeCall) {
        return null;
      }
      return {
        value: {
          signatures: [
            {
              label: researchSdkSignature(activeCall.contract),
              documentation: localizedDescription(activeCall.contract),
              parameters: activeCall.contract.parameters.map((parameter) => ({
                label: parameter.name,
                documentation: localizedDescription(parameter),
              })),
            },
          ],
          activeSignature: 0,
          activeParameter: activeCall.activeParameter,
        },
        dispose() {},
      };
    },
  });

  monacoInstance.languages.registerHoverProvider('python', {
    provideHover(model: monaco.editor.ITextModel, position: monaco.Position) {
      if (!isResearchPythonModel(model)) {
        return null;
      }
      const contract = researchSdkHoverContract(model.getValue(), model.getOffsetAt(position));
      if (!contract) {
        return null;
      }
      const details = [`\`${researchSdkSignature(contract)}\``, localizedDescription(contract)];
      if (contract.returns.kind === 'dataframe') {
        details.push(
          contract.returns.columns
            .map(
              (column) =>
                `- \`${column.name}\`: \`${column.pythonType}\` — ${localizedDescription(column)}`,
            )
            .join('\n'),
        );
      }
      return { contents: details.map((value) => ({ value })) };
    },
  });
}

async function researchDataCatalogSuggestions(
  monacoInstance: Monaco,
  context: Extract<ResearchSdkCompletionContext, { kind: 'parameter_value' }>,
  range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
  const assetType = researchAssetType(
    researchSdkStringArgument(context.argumentSource, context.contract, 'asset_type'),
  );
  const identifier = researchSdkStringArgument(
    context.argumentSource,
    context.contract,
    'identifier',
  );
  if (context.parameterName === 'identifier' && context.partial.trim().length === 0) {
    return [];
  }

  try {
    const catalog = await cachedResearchDataCatalog(
      context.parameterName === 'identifier' ? context.partial : (identifier ?? ''),
      assetType,
    );
    if (context.parameterName === 'identifier') {
      return catalog.instruments.map((instrument) => ({
        label: {
          label: instrument.identifier,
          description: localizedCatalogName(instrument),
        },
        kind: monacoInstance.languages.CompletionItemKind.Reference,
        detail: [localizedAssetType(instrument.assetType), ...instrument.tags].join(' · '),
        documentation: instrument.description,
        insertText: instrument.identifier,
        range,
        sortText: `0_${instrument.identifier}`,
      }));
    }

    const exactInstrument = catalog.instruments.find(
      (instrument) => instrument.assetType === assetType && instrument.identifier === identifier,
    );
    const compatibleIds = exactInstrument
      ? new Set(exactInstrument.compatibleMeasureIds)
      : undefined;
    const normalizedPartial = context.partial.toLocaleLowerCase();
    return catalog.measures
      .filter(
        (measure) =>
          (!compatibleIds || compatibleIds.has(measure.id)) &&
          [measure.id, measure.nameZh, measure.nameEn].some((value) =>
            value.toLocaleLowerCase().includes(normalizedPartial),
          ),
      )
      .map((measure) => ({
        label: {
          label: measure.id,
          description: localeStore.locale === 'zh' ? measure.nameZh : measure.nameEn,
        },
        kind: monacoInstance.languages.CompletionItemKind.Value,
        detail: `${measure.unit} · v${measure.version}`,
        documentation: localizedDescription(measure),
        insertText: measure.id,
        range,
        sortText: `0_${measure.id}`,
      }));
  } catch {
    return [];
  }
}

function cachedResearchDataCatalog(
  query: string,
  assetType?: ResearchAssetTypeV1,
): Promise<ResearchDataCatalogResultV1> {
  const key = `${assetType ?? 'all'}:${query.trim().toLocaleLowerCase()}`;
  const existing = researchDataCatalogRequests.get(key);
  if (existing) {
    return existing;
  }
  if (researchDataCatalogRequests.size >= 60) {
    researchDataCatalogRequests.clear();
  }
  const request = searchResearchDataCatalog(query, assetType).catch((error) => {
    researchDataCatalogRequests.delete(key);
    throw error;
  });
  researchDataCatalogRequests.set(key, request);
  return request;
}

function researchAssetType(value: string | undefined): ResearchAssetTypeV1 | undefined {
  return value === 'stock' || value === 'etf' || value === 'index' || value === 'future'
    ? value
    : undefined;
}

function localizedCatalogName(value: { nameZh: string; nameEn?: string }): string {
  return localeStore.locale === 'zh' ? value.nameZh : (value.nameEn ?? value.nameZh);
}

function localizedAssetType(assetType: ResearchAssetTypeV1): string {
  if (localeStore.locale !== 'zh') {
    return assetType;
  }
  return { stock: '股票', etf: 'ETF', index: '指数', future: '期货' }[assetType];
}

function isResearchPythonModel(model: monaco.editor.ITextModel): boolean {
  return model.getLanguageId() === 'python' && model.uri.path.startsWith('/research/');
}

function completionRange(
  monacoInstance: Monaco,
  position: monaco.Position,
  partial: string,
): monaco.IRange {
  return new monacoInstance.Range(
    position.lineNumber,
    Math.max(1, position.column - partial.length),
    position.lineNumber,
    position.column,
  );
}

function researchSdkColumnSuggestions(
  monacoInstance: Monaco,
  contract: ResearchSdkFunctionContractV1 | undefined,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  if (!contract || contract.returns.kind !== 'dataframe') {
    return [];
  }
  return contract.returns.columns.map((column) => ({
    label: column.name,
    kind: monacoInstance.languages.CompletionItemKind.Field,
    detail: column.pythonType,
    documentation: localizedDescription(column),
    insertText: column.name,
    range,
    sortText: `0_${column.name}`,
  }));
}

function researchSdkSignature(contract: ResearchSdkFunctionContractV1): string {
  const parameters: string[] = [];
  let keywordOnlyStarted = false;
  for (const parameter of contract.parameters) {
    if (parameter.keywordOnly && !keywordOnlyStarted) {
      parameters.push('*');
      keywordOnlyStarted = true;
    }
    const defaultValue =
      parameter.defaultValue === undefined
        ? ''
        : ` = ${parameter.defaultValue === null ? 'None' : JSON.stringify(parameter.defaultValue)}`;
    parameters.push(`${parameter.name}: ${researchSdkParameterType(parameter)}${defaultValue}`);
  }
  const returnType =
    contract.returns.kind === 'dataframe'
      ? `DataFrame[${contract.returns.columns.map((column) => column.name).join(', ')}]`
      : 'ResearchChart';
  return `${contract.qualifiedName}(${parameters.join(', ')}) -> ${returnType}`;
}

function researchSdkParameterType(parameter: ResearchSdkParameterContractV1): string {
  switch (parameter.type) {
    case 'enum':
      return (parameter.values ?? []).map((value) => JSON.stringify(value)).join(' | ');
    case 'string':
    case 'date':
      return 'str';
    case 'integer':
      return 'int';
    case 'dataframe':
      return 'DataFrame';
    case 'string_or_string_list':
      return 'str | list[str]';
    case 'string_map':
      return 'dict[str, str]';
  }
}

function researchSdkSnippet(contract: ResearchSdkFunctionContractV1): string {
  const positional = contract.parameters.filter((parameter) => !parameter.keywordOnly);
  const keyword = contract.parameters.filter(
    (parameter) => parameter.keywordOnly && parameter.required,
  );
  let placeholder = 0;
  const lines = [
    ...positional.map((parameter) => researchSdkPlaceholder(parameter, (placeholder += 1))),
    ...keyword.map(
      (parameter) => `${parameter.name}=${researchSdkPlaceholder(parameter, (placeholder += 1))}`,
    ),
  ];
  if (lines.length <= 2) {
    return `${contract.name}(${lines.join(', ')})`;
  }
  return `${contract.name}(\n    ${lines.join(',\n    ')},\n)`;
}

function researchSdkParameterSnippet(parameter: ResearchSdkParameterContractV1): string {
  return `${parameter.name}=${researchSdkPlaceholder(parameter, 1)}`;
}

function researchSdkPlaceholder(
  parameter: ResearchSdkParameterContractV1,
  placeholder: number,
): string {
  const value =
    parameter.defaultValue ?? parameter.values?.[0] ?? suggestedParameterValue(parameter);
  const literal = parameter.type === 'dataframe' ? String(value) : JSON.stringify(value);
  return `\${${placeholder}:${literal}}`;
}

function suggestedParameterValue(parameter: ResearchSdkParameterContractV1): string {
  switch (parameter.name) {
    case 'identifier':
      return '000300.SH';
    case 'start':
      return '20200101';
    case 'end':
      return '20251231';
    case 'x':
      return 'date';
    case 'y':
      return 'value';
    default:
      return parameter.name;
  }
}

function localizedDescription(value: { descriptionZh: string; descriptionEn: string }): string {
  return localeStore.locale === 'zh' ? value.descriptionZh : value.descriptionEn;
}
