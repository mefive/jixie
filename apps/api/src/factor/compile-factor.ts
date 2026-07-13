import type { FactorBar } from '@jixie/shared';
import { loadIsolatedModule, toCommonJs, type IsolatedModule } from '../lib/isolate-run.js';
import type { UserLogSink } from '../lib/sandbox-console.js';

/**
 * Compile a factor (defineFactor TS source) into an isolated-vm-backed handle — the hard sandbox
 * boundary for factor code (2026-07-07 Phase A; strategy onBar is still new Function, Phase B done separately).
 * Execution is BATCHED: one wall-crossing computes a whole array of items (per rebalance date on
 * the fast path, per stock on the windowed path) — 650k per-stock wall crossings would be crushed by
 * serialization overhead; batching cuts the crossing count down to the order of days/stocks. Each item carries its bar and, for windowed factors, the hfq close/
 * date window ENDING at the evaluation day; ctx.history slices tails of that window in-wall.
 */
export interface FactorBatchItem {
  bar: FactorBar;
  closes?: number[]; // tail window ending at the evaluation day (windowed factors only)
  dates?: string[]; // aligned trade dates for the window
  turnoverRatesF?: (number | null)[]; // aligned free-float turnover rates for the window
}

export interface CompiledFactor {
  name: string;
  window?: number;
  /** One wall-crossing: per-item factor value (null = dropped: returned null / NaN / threw). */
  computeBatch(items: FactorBatchItem[]): Promise<(number | null)[]>;
  dispose(): void;
}

const FACTOR_SETUP = `
{
  const factor = __module.exports.default ?? __module.exports;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error('因子需 \`export default defineFactor({ name, compute(bar) { … } })\`');
  }
  if (!factor.name) {
    factor.name = '未命名因子';
  }
  const NO_HISTORY_CTX = {
    history() {
      throw new Error('要用 ctx.history 需在 defineFactor 里声明 window(所需交易日数,含当天)');
    },
  };
  __entries.meta = () => JSON.stringify({ name: factor.name, window: factor.window ?? null });
  __entries.computeBatch = (itemsJson) => {
    const items = JSON.parse(itemsJson);
    const values = items.map((item) => {
      try {
        const ctx = item.closes
          ? {
              history(n, field) {
                const src = field === 'date'
                  ? item.dates
                  : field === 'turnoverRateF'
                    ? item.turnoverRatesF
                    : item.closes;
                if (n <= 0 || src.length < n) {
                  return [];
                }
                return src.slice(src.length - n);
              },
            }
          : NO_HISTORY_CTX;
        const value = factor.compute(item.bar, ctx);
        return value == null || !Number.isFinite(value) ? null : value;
      } catch (e) {
        __logs.push('[factor-error] ' + (e && e.message ? e.message : String(e)));
        return null;
      }
    });
    return JSON.stringify(values);
  };
}
`;

export async function compileFactor(
  source: string,
  onUserLog?: UserLogSink,
): Promise<CompiledFactor> {
  const userJs = await toCommonJs(source, 'factor code');
  const module: IsolatedModule = await loadIsolatedModule({
    userJs,
    noun: 'factor code',
    injectGlobals: 'globalThis.defineFactor = (factor) => factor;',
    setup: FACTOR_SETUP,
  });

  // Console lines (and caught compute errors) drain to the run-log sink after every crossing.
  const drainTo = (sink?: UserLogSink) => {
    if (!sink) {
      module.drainLogs();
      return;
    }
    for (const line of module.drainLogs()) {
      if (line.startsWith('[error] ')) {
        sink('error', line.slice('[error] '.length));
      } else if (line.startsWith('[warn] ')) {
        sink('warn', line.slice('[warn] '.length));
      } else if (line.startsWith('[factor-error] ')) {
        sink('error', line); // keep the prefix — analysis.ts uses it to surface the first error
      } else {
        sink('info', line);
      }
    }
  };

  let meta: { name: string; window: number | null };
  try {
    meta = JSON.parse(await module.callJson('meta', [])) as typeof meta;
  } catch (e) {
    module.dispose();
    throw e;
  }

  return {
    name: meta.name,
    window: meta.window ?? undefined,
    async computeBatch(items) {
      const json = await module.callJson('computeBatch', [JSON.stringify(items)], {
        timeoutMs: 30_000, // a whole date's cross-section / a stock's full history per crossing
      });
      drainTo(onUserLog);
      return JSON.parse(json) as (number | null)[];
    },
    dispose: () => module.dispose(),
  };
}
