import { DiffEditor, loader } from '@monaco-editor/react';
import type { ResearchCellChangeOperationV1 } from '@jixie/shared';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'json' ? new jsonWorker() : new editorWorker();
  },
};
loader.config({ monaco });

const RESEARCH_DIFF_THEME = 'jixie-research-diff';

interface ResearchCellChangeDiffProps {
  proposalId: string;
  operation: ResearchCellChangeOperationV1;
}

/** Read-only Monaco diff; applying the proposal always remains a separate explicit action. */
export default function ResearchCellChangeDiff({
  proposalId,
  operation,
}: ResearchCellChangeDiffProps) {
  const language = operation.cellKind === 'validation' ? 'json' : operation.cellKind;
  const modelBase = `file:///research-proposals/${encodeURIComponent(proposalId)}/${encodeURIComponent(operation.operationId)}`;
  return (
    <DiffEditor
      height="min(64vh, 620px)"
      original={operation.beforeSource}
      modified={operation.afterSource}
      originalLanguage={language}
      modifiedLanguage={language}
      originalModelPath={`${modelBase}.before.${extension(operation.cellKind)}`}
      modifiedModelPath={`${modelBase}.after.${extension(operation.cellKind)}`}
      beforeMount={configureResearchDiffTheme}
      theme={RESEARCH_DIFF_THEME}
      options={{
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: 20,
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        renderOverviewRuler: false,
        renderSideBySide: false,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        diffWordWrap: 'on',
        padding: { top: 12, bottom: 12 },
        renderIndicators: true,
        enableSplitViewResizing: true,
      }}
    />
  );
}

function configureResearchDiffTheme(monacoInstance: typeof monaco) {
  monacoInstance.editor.defineTheme(RESEARCH_DIFF_THEME, {
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

function extension(kind: ResearchCellChangeOperationV1['cellKind']): string {
  switch (kind) {
    case 'markdown':
      return 'md';
    case 'python':
      return 'py';
    case 'validation':
      return 'json';
  }
}
