import type { FactorBar } from '@jixie/shared';
import type { CustomFactor, FactorCtx } from '../factor/factor-sdk.js';
import type { EngineData } from './data.js';
import type { BarRow } from './types.js';

/**
 * Custom (defineFactor) factors inside the BACKTEST ENGINE (factor-to-strategy.md Step 2): a strategy
 * declares `factors: ['custom:<id>']` and reads today's value via ctx.factor — computed on the fly,
 * nothing stored. The host prepares each referenced factor's code (ownership-checked, TS→CJS
 * transformed) and passes it in EngineConfig.customFactors; THIS file evaluates and serves it in
 * whatever world the engine runs in — inside the isolate on the walled lane (DB-origin code stays
 * behind the wall by construction), plainly on the direct lane. Pure ECMAScript: it is part of the
 * wall bundle.
 */
export interface CustomFactorModule {
  key: string; // 'custom:<factor row id>'
  js: string; // the factor module, host-transformed TS→CJS
}

/** Evaluate one factor module — mirrors wall-entry's strategy evaluation (same ambient style). */
export function evaluateCustomFactorModule(mod: CustomFactorModule): CustomFactor {
  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const run = new Function('module', 'exports', 'defineFactor', 'require', mod.js);
    run(
      moduleShim,
      moduleShim.exports,
      (factor: CustomFactor) => factor,
      (id: string) => {
        throw new Error(`factor code cannot import external modules (${id})`);
      },
    );
  } catch (e) {
    throw new Error(
      `factor ${mod.key} evaluation error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const factor = (moduleShim.exports.default ?? moduleShim.exports) as Partial<CustomFactor>;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error(`factor ${mod.key} must \`export default defineFactor({ compute })\``);
  }
  return factor as CustomFactor;
}

const NO_HISTORY_CTX: FactorCtx = {
  history() {
    throw new Error(
      'declare `window` in defineFactor to use ctx.history (trading days needed, incl. today)',
    );
  },
} as FactorCtx;

/** Per-run memo cap — bounds memory on windowed factors over long ranges; oldest entries evicted. */
const MEMO_CAP = 100_000;

/**
 * Serves ctx.factor('custom:…') reads: per-(factor, date, code) compute with a bounded per-run memo
 * (a monthly rebalance re-reads the same values while ranking — memoizing keeps that O(1)).
 * Windowed factors read the strategy-side bars cache — same "K-line must be loaded" contract as
 * ctx.sma (ensureBars first); without bars the window is short and compute sees [] from history().
 */
export class CustomFactorRuntime {
  private memo = new Map<string, number | null>();

  constructor(
    private factors: Map<string, CustomFactor>,
    private engineData: EngineData,
    private onComputeError: (key: string, message: string) => void,
  ) {}

  has(key: string): boolean {
    return this.factors.has(key);
  }

  value(key: string, date: string, code: string, crossBar: BarRow | null): number | null {
    const memoKey = `${key}|${date}|${code}`;
    const hit = this.memo.get(memoKey);
    if (hit !== undefined || this.memo.has(memoKey)) {
      return hit ?? null;
    }

    const value = this.compute(this.factors.get(key)!, key, date, code, crossBar);
    if (this.memo.size >= MEMO_CAP) {
      this.memo.delete(this.memo.keys().next().value!);
    }
    this.memo.set(memoKey, value);
    return value;
  }

  private compute(
    factor: CustomFactor,
    key: string,
    date: string,
    code: string,
    crossBar: BarRow | null,
  ): number | null {
    let ctx = NO_HISTORY_CTX;
    if (factor.window != null) {
      const bars = this.engineData.bars(code, date, factor.window);
      const closes = bars.map((bar) => bar.adjClose);
      const dates = bars.map((bar) => bar.date);
      ctx = {
        history(n: number, field?: 'date') {
          const source = field === 'date' ? dates : closes;
          if (n <= 0 || source.length < n) {
            return [];
          }
          return source.slice(source.length - n);
        },
      } as FactorCtx;
    }

    try {
      const value = factor.compute(this.assembleFactorBar(date, code, crossBar), ctx);
      return value == null || !Number.isFinite(value) ? null : value;
    } catch (e) {
      this.onComputeError(key, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** The factor-side bar for (code, today), assembled from the engine's cross-section row. Fields the
   * engine does not track (grossprofitMargin / debtToAssets — factor-analysis-side fundamentals) are
   * null here; moneyflow columns come through the engine's own flow-semantics store when declared. */
  private assembleFactorBar(date: string, code: string, crossBar: BarRow | null): FactorBar {
    return {
      code,
      pe: crossBar?.pe ?? null,
      peTtm: crossBar?.peTtm ?? null,
      pb: crossBar?.pb ?? null,
      ps: crossBar?.ps ?? null,
      psTtm: crossBar?.psTtm ?? null,
      dvRatio: crossBar?.dvRatio ?? null,
      dvTtm: crossBar?.dvTtm ?? null,
      totalMv: crossBar?.totalMv ?? null,
      circMv: crossBar?.circMv ?? null,
      turnoverRate: crossBar?.turnoverRate ?? null,
      netMain: this.engineData.factor('mf_net_main', date, code),
      netTotal: this.engineData.factor('mf_net_total', date, code),
      roe: crossBar?.roe ?? null,
      grossprofitMargin: null,
      debtToAssets: null,
    };
  }
}
