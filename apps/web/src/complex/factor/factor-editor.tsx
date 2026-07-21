import Editor, { loader, type Monaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { observer } from 'mobx-react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { Locale } from '@jixie/shared';
import { localeStore } from '@src/i18n/locale-store';

// Bundle Monaco + its TS worker locally (no CDN) — powers autocomplete on `bar.` (the FactorBar fields).
self.MonacoEnvironment = {
  getWorker(_id, label) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker();
  },
};
loader.config({ monaco });

// Bilingual doc comments for the factor SDK ambient types. The TS signatures never vary by locale — only
// this copy does — so re-registering on a language switch keeps type-checking identical.
const FACTOR_DOCS: Record<string, Record<Locale, string>> = {
  pe: { zh: '市盈率', en: 'P/E' },
  peTtm: { zh: '市盈率 TTM', en: 'P/E (TTM)' },
  pb: { zh: '市净率', en: 'P/B' },
  ps: { zh: '市销率', en: 'P/S' },
  psTtm: { zh: '市销率 TTM', en: 'P/S (TTM)' },
  dvRatio: { zh: '股息率 %', en: 'Dividend yield %' },
  dvTtm: { zh: '股息率 TTM %', en: 'Dividend yield (TTM) %' },
  totalMv: { zh: '总市值(万元)', en: 'Total market cap (10k yuan)' },
  circMv: { zh: '流通市值(万元)', en: 'Float market cap (10k yuan)' },
  turnoverRate: { zh: '换手率 %', en: 'Turnover rate %' },
  netMain: {
    zh: '主力净额(万元,当日精确,缺则 null)',
    en: 'Main-force net inflow (10k yuan, exact for the day, null if missing)',
  },
  netTotal: {
    zh: '总净额(万元,当日精确,缺则 null)',
    en: 'Total net inflow (10k yuan, exact for the day, null if missing)',
  },
  roe: {
    zh: '净资产收益率 %(最近一份 annDate ≤ 当日的报告,PIT;未披露则 null)',
    en: 'Return on equity % (latest report with annDate ≤ today, point-in-time; null if none published)',
  },
  grossprofitMargin: {
    zh: '毛利率 %(as-of,PIT;未披露则 null)',
    en: 'Gross profit margin % (as-of, point-in-time; null if none published)',
  },
  debtToAssets: {
    zh: '资产负债率 %(as-of,PIT;未披露则 null)',
    en: 'Debt-to-assets ratio % (as-of, point-in-time; null if none published)',
  },
  historyClose: {
    zh: '后复权收盘价窗口,[最旧 … 当天] 共 n 个;历史不足返回 []。需在 defineFactor 声明 window ≥ n。',
    en: 'Adjusted (hfq) close window, [oldest … today] of n values; returns [] if history is insufficient. Declare window ≥ n in defineFactor.',
  },
  historyDate: {
    zh: '窗口对应的交易日(YYYYMMDD),与收盘价逐位对齐 — 可用于停牌间隙检查。',
    en: 'Trade dates (YYYYMMDD) for the window, aligned position-by-position with the closes — usable for suspension-gap checks.',
  },
  historyAmount: {
    zh: '成交额历史(千元),与收盘价逐位对齐;源数据缺失时为 null。',
    en: 'Daily turnover amount history (thousand yuan), aligned with closes; null when unavailable.',
  },
  name: { zh: '因子名(展示用)', en: 'Factor name (for display)' },
  window: {
    zh: '所需历史长度(交易日数,含当天)。声明后 compute 里才能用 ctx.history。',
    en: 'Required history length (trading days, including today). Declaring it enables ctx.history inside compute.',
  },
  compute: {
    zh: '逐股算因子值:返回数字,或 null 剔除该股。方向由分析的 IC 符号揭示 —— 别预先取负。',
    en: "Compute the factor value per stock: return a number, or null to drop the stock. Direction is revealed by the IC sign in analysis — don't pre-negate.",
  },
  defineFactor: {
    zh: '定义一个因子。写法:export default defineFactor({ name, window?, compute(bar, ctx) { … } })',
    en: 'Define a factor. Usage: export default defineFactor({ name, window?, compute(bar, ctx) { … } })',
  },
};

// The factor authoring surface as an ambient .d.ts in the active locale — mirrors the strategy SDK.
function factorDts(locale: Locale): string {
  const doc = (key: string) => FACTOR_DOCS[key][locale];
  return `
interface FactorBar {
  readonly code: string;
  /** ${doc('pe')} */ readonly pe: number | null;
  /** ${doc('peTtm')} */ readonly peTtm: number | null;
  /** ${doc('pb')} */ readonly pb: number | null;
  /** ${doc('ps')} */ readonly ps: number | null;
  /** ${doc('psTtm')} */ readonly psTtm: number | null;
  /** ${doc('dvRatio')} */ readonly dvRatio: number | null;
  /** ${doc('dvTtm')} */ readonly dvTtm: number | null;
  /** ${doc('totalMv')} */ readonly totalMv: number | null;
  /** ${doc('circMv')} */ readonly circMv: number | null;
  /** ${doc('turnoverRate')} */ readonly turnoverRate: number | null;
  /** ${doc('netMain')} */ readonly netMain: number | null;
  /** ${doc('netTotal')} */ readonly netTotal: number | null;
  /** ${doc('roe')} */ readonly roe: number | null;
  /** ${doc('grossprofitMargin')} */ readonly grossprofitMargin: number | null;
  /** ${doc('debtToAssets')} */ readonly debtToAssets: number | null;
}
interface FactorCtx {
  /** ${doc('historyClose')} */
  history(n: number): number[];
  /** ${doc('historyDate')} */
  history(n: number, field: 'date'): string[];
  /** ${doc('historyAmount')} */
  history(n: number, field: 'amount'): (number | null)[];
  /** Free-float turnover-rate (%) history; null means unavailable that day. */
  history(n: number, field: 'turnoverRateF'): (number | null)[];
}
interface CustomFactor {
  /** ${doc('name')} */
  name: string;
  /** ${doc('window')} */
  window?: number;
  /** Minimum fraction of market trading days required inside the declared window (0.1–1). */
  minCoverage?: number;
  /** ${doc('compute')} */
  compute: (bar: FactorBar, ctx: FactorCtx) => number | null;
}
/** ${doc('defineFactor')} */
declare function defineFactor(factor: CustomFactor): CustomFactor;
`;
}

// Retained so a locale switch can dispose the previous ambient lib before re-adding the new-locale one.
let monacoRef: Monaco | null = null;
let factorLibDisposable: monaco.IDisposable | null = null;
let staticInstalled = false;

// (Re)register the ambient factor .d.ts in the given locale — signatures stay identical, only the
// doc-comment language changes. Disposing first avoids a duplicate lib for the same path.
function applyFactorDts(m: Monaco, locale: Locale) {
  factorLibDisposable?.dispose();
  factorLibDisposable = m.languages.typescript.typescriptDefaults.addExtraLib(
    factorDts(locale),
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

// `observer` so the hover docs re-register live when the global locale switches.
function FactorEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean; // preset (builtin) factors show their code but reject edits
}) {
  const locale = localeStore.locale;

  // Re-register the ambient factor .d.ts whenever the UI locale changes so hover docs switch live
  // (monacoRef is set once the editor has mounted via installFactorSdk).
  useEffect(() => {
    if (monacoRef) {
      applyFactorDts(monacoRef, locale);
    }
  }, [locale]);

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
        readOnly,
      }}
    />
  );
}

export default observer(FactorEditor);
