import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import i18n from '@src/i18n';
import { SDK_DTS } from './sdk-dts';
import { SDK_ENTRIES, LINKABLE_TYPES } from './sdk-reference';

// Every SDK member name (ctx.* methods + BarRow fields) and the business-type names — the tokens the
// editor turns into clickable links → the doc page.
const MEMBER_NAMES = [...new Set(SDK_ENTRIES.map((e) => e.name))];

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
  if (sdkInstalled) {
    return;
  }
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

  // Make SDK members (ctx.history, b.peTtm, …) and type names (StrategyCtx, BarRow, …) Cmd+click links to
  // the doc page (absolute URL → opens a new tab). Single source: the names come from sdk-reference.
  const memberRe = new RegExp(`\\.(${MEMBER_NAMES.join('|')})\\b`, 'g');
  const typeRe = new RegExp(`\\b(${LINKABLE_TYPES.join('|')})\\b`, 'g');
  m.languages.registerLinkProvider('typescript', {
    provideLinks(model: monaco.editor.ITextModel) {
      const text = model.getValue();
      const links: monaco.languages.ILink[] = [];
      const add = (offset: number, name: string) => {
        const s = model.getPositionAt(offset);
        const e = model.getPositionAt(offset + name.length);
        links.push({
          range: {
            startLineNumber: s.lineNumber,
            startColumn: s.column,
            endLineNumber: e.lineNumber,
            endColumn: e.column,
          },
          url: `${location.origin}/docs#${name}`,
          tooltip: i18n.t('lab:sdkDocTooltip', { name }),
        });
      };
      let mm: RegExpExecArray | null;
      memberRe.lastIndex = 0;
      while ((mm = memberRe.exec(text)) !== null) {
        add(mm.index + 1, mm[1]);
      } // +1: skip the dot
      typeRe.lastIndex = 0;
      while ((mm = typeRe.exec(text)) !== null) {
        add(mm.index, mm[1]);
      }
      return { links };
    },
  });
}

/**
 * The strategy code editor — Monaco with the SDK types loaded, so the user gets autocomplete on `ctx`
 * and type errors against the real API. Lazy-loaded (Monaco is heavy → its own chunk).
 */
export default function CodeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Editor
      height="100%"
      defaultLanguage="typescript"
      path="file:///strategy.ts"
      theme="vs"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={installSdk}
      onMount={(editor) => {
        // Jump to the SDK doc for the symbol under the cursor (right-click menu + ⌘/Ctrl+I) — a keyboard
        // alternative to Cmd+clicking the symbol (which the link provider makes a link to /docs#name).
        editor.addAction({
          id: 'jixie.openSdkDoc',
          label: i18n.t('lab:sdkDocMenuLabel'),
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 1.5,
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
          run(ed) {
            const pos = ed.getPosition();
            const word = pos ? ed.getModel()?.getWordAtPosition(pos)?.word : undefined;
            window.open(word ? `/docs#${word}` : '/docs', '_blank');
          },
        });
      }}
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
        // Render hover / suggest / etc. in a fixed root container so they escape the editor wrapper's
        // overflow:hidden clipping (like VS Code) — a hover above the editor's top edge no longer gets cut.
        fixedOverflowWidgets: true,
      }}
    />
  );
}
