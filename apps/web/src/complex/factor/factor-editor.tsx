import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Bundle Monaco + its TS worker locally (no CDN) — powers autocomplete on `bar.` (the FactorBar fields).
self.MonacoEnvironment = {
  getWorker(_id, label) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker();
  },
};
loader.config({ monaco });

// The custom-factor authoring surface as an ambient .d.ts — mirrors the strategy SDK's approach.
const FACTOR_DTS = `
interface FactorBar {
  readonly code: string;
  /** 市盈率 */ readonly pe: number | null;
  /** 市盈率 TTM */ readonly peTtm: number | null;
  /** 市净率 */ readonly pb: number | null;
  /** 市销率 */ readonly ps: number | null;
  /** 市销率 TTM */ readonly psTtm: number | null;
  /** 股息率 % */ readonly dvRatio: number | null;
  /** 股息率 TTM % */ readonly dvTtm: number | null;
  /** 总市值(万元) */ readonly totalMv: number | null;
  /** 流通市值(万元) */ readonly circMv: number | null;
  /** 换手率 % */ readonly turnoverRate: number | null;
}
interface CustomFactor {
  /** 因子名(展示用) */
  name: string;
  /** 逐股算因子值:返回数字,或 null 剔除该股。方向由分析的 IC 符号揭示 —— 别预先取负。 */
  compute: (bar: FactorBar) => number | null;
}
/** 定义一个自定义因子。写法:export default defineFactor({ name, compute(bar) { … } }) */
declare function defineFactor(factor: CustomFactor): CustomFactor;
`;

let installed = false;

function installFactorSdk(m: Monaco) {
  if (installed) {
    return;
  }
  installed = true;
  const ts = m.languages.typescript;
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    noEmit: true,
    strict: false,
    lib: ['es2020'],
  });
  ts.typescriptDefaults.addExtraLib(FACTOR_DTS, 'file:///jixie-factor-sdk.d.ts');
}

export default function FactorEditor({
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
      path="factor.ts"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={installFactorSdk}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  );
}
