import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { SDK_DTS } from './sdk-dts';

// Bundle Monaco + its TS worker locally (no CDN) — the TS worker is what powers autocomplete/diagnostics.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker();
  },
};
loader.config({ monaco });

let sdkInstalled = false;

// Teach Monaco the SDK once: ambient defineStrategy + ctx types, and TS options that accept the
// import-free `export default defineStrategy({…})` module shape.
function installSdk(m: Monaco) {
  if (sdkInstalled) return;
  sdkInstalled = true;
  const ts = m.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: false,
    lib: ['es2020'],
  });
  ts.typescriptDefaults.addExtraLib(SDK_DTS, 'file:///jixie-sdk.d.ts');
}

/**
 * The strategy code editor — Monaco with the SDK types loaded, so the user gets autocomplete on `ctx`
 * and type errors against the real API. Lazy-loaded (Monaco is heavy → its own chunk).
 */
export default function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Editor
      height="100%"
      defaultLanguage="typescript"
      path="file:///strategy.ts"
      theme="vs"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={installSdk}
      options={{
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'none',
        overviewRulerLanes: 0,
      }}
    />
  );
}
