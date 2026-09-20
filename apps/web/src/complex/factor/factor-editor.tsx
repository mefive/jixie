import '@src/components/monaco-setup';
import Editor, { type Monaco } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react';
import * as monaco from 'monaco-editor';
import { buildFactorSdkDts, type FactorLanguage, type Locale } from '@jixie/shared';
import { localeStore } from '@src/i18n/locale-store';
import {
  attachResearchPythonModel,
  installResearchPythonLanguage,
  researchPythonModelUri,
} from '../research/research-python-language';

// `observer` so the hover docs re-register live when the global locale switches.
function FactorEditor({
  value,
  onChange,
  language = 'typescript',
  documentId = 'factor',
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: FactorLanguage;
  documentId?: string;
  readOnly?: boolean; // preset (builtin) factors show their code but reject edits
}) {
  const locale = localeStore.locale;
  const sourceRef = useRef(value);
  const pythonBindingRef = useRef<monaco.IDisposable | null>(null);
  sourceRef.current = value;

  // Re-register the ambient factor .d.ts whenever the UI locale changes so hover docs switch live
  // (monacoRef is set once the editor has mounted via installFactorSdk).
  useEffect(() => {
    if (monacoRef) {
      applyFactorDts(monacoRef, locale);
    }
  }, [locale]);

  useEffect(
    () => () => {
      pythonBindingRef.current?.dispose();
      pythonBindingRef.current = null;
    },
    [documentId, language],
  );

  const modelPath =
    language === 'python'
      ? researchPythonModelUri(monaco, `factor:${documentId}`, 'definition').toString()
      : `file:///factors/${encodeURIComponent(documentId)}.ts`;

  return (
    <Editor
      key={`${language}:${documentId}`}
      height="100%"
      language={language}
      path={modelPath}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={(monacoInstance) => {
        if (language === 'python') {
          installResearchPythonLanguage(monacoInstance);
        } else {
          installFactorSdk(monacoInstance);
        }
      }}
      onMount={(editor, monacoInstance) => {
        pythonBindingRef.current?.dispose();
        if (language !== 'python') {
          return;
        }
        pythonBindingRef.current = attachResearchPythonModel(monacoInstance, {
          documentId: `factor:${documentId}`,
          cellId: 'definition',
          model: editor.getModel()!,
          editor,
          getCells: () => [{ id: 'definition', source: sourceRef.current }],
          onChange,
        });
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        readOnly,
      }}
    />
  );
}

export default observer(FactorEditor);

// Retained so a locale switch can dispose the previous ambient lib before re-adding the new-locale one.
let monacoRef: Monaco | null = null;
let factorLibDisposable: monaco.IDisposable | null = null;
let staticInstalled = false;

// (Re)register the ambient factor .d.ts in the given locale — signatures stay identical, only the
// doc-comment language changes. Disposing first avoids a duplicate lib for the same path.
function applyFactorDts(m: Monaco, locale: Locale) {
  factorLibDisposable?.dispose();
  factorLibDisposable = m.languages.typescript.typescriptDefaults.addExtraLib(
    buildFactorSdkDts(locale),
    'file:///jixie-factor-sdk.d.ts',
  );
}

function installFactorSdk(m: Monaco) {
  monacoRef = m;
  applyFactorDts(m, localeStore.locale);
  if (staticInstalled) {
    return;
  }
  staticInstalled = true;
  const ts = m.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: false,
    lib: ['es2020'],
  });
}
