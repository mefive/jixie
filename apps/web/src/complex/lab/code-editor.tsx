import Editor, { loader, type Monaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { observer } from 'mobx-react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { DtsFactorOption, Locale } from '@jixie/shared';
import i18n from '@src/i18n';
import { localeStore } from '@src/i18n/locale-store';
import { getFactorCatalog } from '@src/api/client';
import { sdkDts } from './sdk-dts';
import { SDK_ENTRIES, LINKABLE_TYPES } from '@jixie/shared';

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

// Retained so a locale switch can dispose the previous ambient lib before re-adding the new-locale one.
let monacoRef: Monaco | null = null;
let sdkLibDisposable: monaco.IDisposable | null = null;
let staticSdkInstalled = false;
// The user's factor catalog (presets + own factors) → the FactorKey union members, fetched once per
// page load; until it arrives (or if it fails) the dts falls back to the `custom:${string}` tail.
let factorOptions: DtsFactorOption[] = [];
let factorOptionsRequested = false;

interface FactorReference {
  option: DtsFactorOption;
  start: number;
  end: number;
}

// Find a catalog-backed custom factor string. Restricting this to known catalog entries prevents an
// unrelated string that happens to start with "custom:" from becoming a navigation link.
function factorReferences(text: string): FactorReference[] {
  const optionsByKey = new Map(factorOptions.map((option) => [option.key, option]));
  const references: FactorReference[] = [];
  const literal = /(['"`])(custom:[^'"`\\\s]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = literal.exec(text)) !== null) {
    const option = optionsByKey.get(match[2]);
    if (option) {
      references.push({ option, start: match.index + 1, end: match.index + 1 + match[2].length });
    }
  }
  return references;
}

function factorUrl(option: DtsFactorOption): string {
  return `${location.origin}/factors?factor=${encodeURIComponent(option.key.slice('custom:'.length))}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
}

// (Re)register the ambient SDK .d.ts in the given locale — only the doc-comment language changes, so the
// signatures (and thus type-checking) stay identical. Disposing first avoids a duplicate-lib for the path.
function applySdkDts(m: Monaco, locale: Locale) {
  sdkLibDisposable?.dispose();
  sdkLibDisposable = m.languages.typescript.typescriptDefaults.addExtraLib(
    sdkDts(locale, factorOptions),
    'file:///jixie-sdk.d.ts',
  );
}

// ctx.factor autocomplete for the user's actual factors: load the catalog once, then re-register the
// dts with the concrete custom:<id> union members (each carrying the factor's name as a comment).
function loadFactorOptions(m: Monaco) {
  if (factorOptionsRequested) {
    return;
  }
  factorOptionsRequested = true;
  getFactorCatalog()
    .then((catalog) => {
      factorOptions = catalog.map((meta) => ({
        key: `custom:${meta.key}`,
        label: meta.label,
        description: meta.description,
      }));
      applySdkDts(m, localeStore.locale);
    })
    .catch(() => {}); // no catalog → the template-literal tail still accepts any custom:<id>
}

// Teach Monaco the SDK: the locale-independent bits (compiler options + doc link provider) once, then the
// ambient defineStrategy + ctx types in the active locale (re-registered on language switch, see effect).
function installSdk(m: Monaco) {
  monacoRef = m;
  applySdkDts(m, localeStore.locale);
  loadFactorOptions(m);
  if (staticSdkInstalled) {
    return;
  }
  staticSdkInstalled = true;
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
      for (const reference of factorReferences(text)) {
        const s = model.getPositionAt(reference.start);
        const e = model.getPositionAt(reference.end);
        links.push({
          range: {
            startLineNumber: s.lineNumber,
            startColumn: s.column,
            endLineNumber: e.lineNumber,
            endColumn: e.column,
          },
          url: factorUrl(reference.option),
          tooltip: i18n.t('lab:factorLinkTooltip', { name: reference.option.label }),
        });
      }
      return { links };
    },
  });

  m.languages.registerHoverProvider('typescript', {
    provideHover(model: monaco.editor.ITextModel, position: monaco.Position) {
      const offset = model.getOffsetAt(position);
      const reference = factorReferences(model.getValue()).find(
        (candidate) => offset >= candidate.start && offset <= candidate.end,
      );
      if (!reference) {
        return null;
      }

      const s = model.getPositionAt(reference.start);
      const e = model.getPositionAt(reference.end);
      const contents: monaco.IMarkdownString[] = [
        { value: `**${escapeMarkdown(reference.option.label)}**` },
        { value: `\`${reference.option.key}\`` },
      ];
      if (reference.option.description) {
        contents.push({ value: escapeMarkdown(reference.option.description) });
      }
      contents.push({
        value: `[${i18n.t('lab:factorImplementationLink')}](${factorUrl(reference.option)})`,
      });
      return {
        range: new m.Range(s.lineNumber, s.column, e.lineNumber, e.column),
        contents,
      };
    },
  });
}

/**
 * The strategy code editor — Monaco with the SDK types loaded, so the user gets autocomplete on `ctx`
 * and type errors against the real API. Lazy-loaded (Monaco is heavy → its own chunk). `observer` so the
 * hover docs re-register live when the global locale switches.
 */
function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const locale = localeStore.locale;

  // Re-register the ambient SDK .d.ts whenever the UI locale changes so hover docs switch language live
  // (Monaco is a module-global TS worker; installSdk sets monacoRef once the editor has mounted).
  useEffect(() => {
    if (monacoRef) {
      applySdkDts(monacoRef, locale);
    }
  }, [locale]);

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

export default observer(CodeEditor);
