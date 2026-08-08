import type { FactorBar } from '@jixie/shared';
import type { CustomFactor, FactorCtx } from '../factor/factor-sdk.js';
import { factorV2YieldTerm, type FactorV2FieldKey } from '../factor/factor-v2-fields.js';
import type { EngineData } from './data.js';
import type { BarRow } from './types.js';

/**
 * Custom (defineFactor) factors inside the BACKTEST ENGINE (factor-to-strategy.md Step 2): a strategy
 * declares a published factor key and reads today's value via ctx.factor — computed on the fly,
 * nothing stored. The host prepares each referenced factor's code (ownership-checked, TS→CJS
 * transformed) and passes it in EngineConfig.customFactors; THIS file evaluates and serves it in
 * whatever world the engine runs in — inside the isolate on the walled lane (DB-origin code stays
 * behind the wall by construction), plainly on the direct lane. Pure ECMAScript: it is part of the
 * wall bundle.
 */
export interface CustomFactorModule {
  key: string; // immutable Factor.key
  js: string; // the factor module, host-transformed TS→CJS
  historyFields?: CustomFactorHistoryField[];
  /** Omitted means the cross-sectional Factor SDK. Asset-scoped Factor V2 definitions carry
   * their compiler-derived execution contract across the engine wall. */
  analysisKind?: 'cross_sectional' | 'time_series' | 'panel';
  assetSeries?: AssetFactorRuntimeMeta;
}

export type CustomFactorHistoryField = 'turnoverRateF' | 'roe' | 'grossprofitMargin';
export type TimeSeriesFactorInput = FactorV2FieldKey;

export interface AssetFactorRuntimeMeta {
  window: number;
  inputs: TimeSeriesFactorInput[];
}

interface AssetFactorDefinition {
  version: 2;
  analysisKind: 'time_series' | 'panel';
  outputScope: 'asset';
  frequency: 'daily';
  inputs: TimeSeriesFactorInput[];
  window: number;
  compute(ctx: AssetFactorContext): number | null;
}

interface AssetFactorContext {
  value(field: TimeSeriesFactorInput): number | null;
  lag(field: TimeSeriesFactorInput, periods: number): number | null;
}

export type EvaluatedCustomFactor =
  | { kind: 'cross_sectional'; factor: CustomFactor }
  | {
      kind: 'asset_series';
      factor: AssetFactorDefinition;
      meta: AssetFactorRuntimeMeta;
    };

/** Identify expensive auxiliary histories before factor code enters the engine wall. */
export function extractCustomFactorHistoryFields(source: string): CustomFactorHistoryField[] {
  const fields: CustomFactorHistoryField[] = [];
  if (/['"]turnoverRateF['"]/.test(source)) {
    fields.push('turnoverRateF');
  }
  if (/['"]roe['"]/.test(source)) {
    fields.push('roe');
  }
  if (/['"]grossprofitMargin['"]/.test(source)) {
    fields.push('grossprofitMargin');
  }
  return fields;
}

/** Evaluate one factor module — mirrors wall-entry's strategy evaluation (same ambient style). */
export function evaluateCustomFactorModule(mod: CustomFactorModule): EvaluatedCustomFactor {
  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const run = new Function(
      'module',
      'exports',
      'defineFactor',
      'defineFactorV2',
      'require',
      mod.js,
    );
    run(
      moduleShim,
      moduleShim.exports,
      (factor: CustomFactor) => factor,
      (factor: AssetFactorDefinition) => factor,
      (id: string) => {
        throw new Error(`factor code cannot import external modules (${id})`);
      },
    );
  } catch (e) {
    throw new Error(
      `factor ${mod.key} evaluation error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const factor = (moduleShim.exports.default ?? moduleShim.exports) as Partial<
    CustomFactor & AssetFactorDefinition
  >;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error(`factor ${mod.key} must export a factor definition with compute`);
  }
  if (mod.analysisKind === 'time_series' || mod.analysisKind === 'panel') {
    const meta = mod.assetSeries;
    if (
      !meta ||
      factor.version !== 2 ||
      factor.analysisKind !== mod.analysisKind ||
      factor.outputScope !== 'asset' ||
      factor.frequency !== 'daily' ||
      factor.window !== meta.window ||
      !sameStringArray(factor.inputs, meta.inputs)
    ) {
      throw new Error(`factor ${mod.key} does not match its compiled asset-series contract`);
    }
    return {
      kind: 'asset_series',
      factor: factor as AssetFactorDefinition,
      meta,
    };
  }
  return { kind: 'cross_sectional', factor: factor as CustomFactor };
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
 * Serves published-factor reads: per-(factor, date, code) compute with a bounded per-run memo
 * (a monthly rebalance re-reads the same values while ranking — memoizing keeps that O(1)).
 * Windowed factors read the strategy-side bars cache — same "K-line must be loaded" contract as
 * ctx.sma (ensureBars first); without bars the window is short and compute sees [] from history().
 */
export class CustomFactorRuntime {
  private memo = new Map<string, number | null>();

  constructor(
    private factors: Map<string, EvaluatedCustomFactor>,
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
    evaluated: EvaluatedCustomFactor,
    key: string,
    date: string,
    code: string,
    crossBar: BarRow | null,
  ): number | null {
    if (evaluated.kind === 'asset_series') {
      return this.computeAssetSeries(evaluated, key, date, code);
    }
    const factor = evaluated.factor;
    let ctx = NO_HISTORY_CTX;
    if (factor.window != null) {
      const bars = this.engineData.bars(code, date, factor.window);
      const closes = bars.map((bar) => bar.adjClose);
      const dates = bars.map((bar) => bar.date);
      const amounts = bars.map((bar) => bar.amount);
      const turnoverRatesF = bars.map((bar) => bar.turnoverRateF);
      const engineData = this.engineData;
      // Point-in-time ROE per bar date (as-of announcement), materialized lazily on first read —
      // fina is preloaded by run.ts when the factor declares the 'roe' history field.
      let roes: (number | null)[] | null = null;
      let grossProfitMargins: (number | null)[] | null = null;
      ctx = {
        history(
          n: number,
          field?: 'date' | 'amount' | 'turnoverRateF' | 'roe' | 'grossprofitMargin',
        ) {
          // Auxiliary histories are loaded only when requested by host metadata and stay aligned
          // with the OHLC bars.
          const source =
            field === 'date'
              ? dates
              : field === 'amount'
                ? amounts
                : field === 'turnoverRateF'
                  ? turnoverRatesF
                  : field === 'roe'
                    ? (roes ??= bars.map((bar) => engineData.roeHistoryAt(code, bar.date)))
                    : field === 'grossprofitMargin'
                      ? (grossProfitMargins ??= bars.map((bar) =>
                          engineData.grossProfitMarginHistoryAt(code, bar.date),
                        ))
                      : closes;
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

  /** Execute Factor V2 against adjusted bars ending on the decision date. The host compiler has
   * already validated the frozen Factor dependency and attached its contract; this second check and runtime
   * live inside the engine wall so neither direct nor walled backtests trust report statistics as a
   * trading signal. */
  private computeAssetSeries(
    evaluated: Extract<EvaluatedCustomFactor, { kind: 'asset_series' }>,
    key: string,
    date: string,
    code: string,
  ): number | null {
    if (this.engineData.assetType(code) !== 'etf') {
      const message = evaluated.meta.inputs.includes('etf.adjustedClose')
        ? `input etf.adjustedClose requires an ETF code, received ${code}`
        : `asset-scoped Factor V2 requires an ETF code, received ${code}`;
      this.onComputeError(key, message);
      return null;
    }
    const bars = this.engineData.bars(code, date, evaluated.meta.window);
    if (bars.length < evaluated.meta.window) {
      return null;
    }
    const declaredInputs = new Set(evaluated.meta.inputs);
    const currentIndex = bars.length - 1;
    const read = (field: TimeSeriesFactorInput, periods: number): number | null => {
      if (!declaredInputs.has(field)) {
        throw new Error(`Factor code accessed undeclared input ${field}`);
      }
      if (!Number.isInteger(periods) || periods < 0) {
        throw new Error('ctx.lag periods must be a non-negative integer');
      }
      const bar = bars[currentIndex - periods];
      if (!bar) {
        return null;
      }
      const yieldTerm = factorV2YieldTerm(field);
      const value =
        field === 'etf.adjustedClose'
          ? bar.adjClose
          : yieldTerm === null
            ? null
            : this.engineData.governmentYieldAsOf(yieldTerm, bar.date);
      return value != null && Number.isFinite(value) ? value : null;
    };

    try {
      const value = evaluated.factor.compute({
        value: (field) => read(field, 0),
        lag: (field, periods) => read(field, periods),
      });
      return value == null || !Number.isFinite(value) ? null : value;
    } catch (e) {
      this.onComputeError(key, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** The factor-side bar for (code, today), assembled from the engine's cross-section row. Moneyflow
   * columns come through the engine's own flow-semantics store when declared. */
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
      grossprofitMargin: crossBar?.grossprofitMargin ?? null,
      debtToAssets: crossBar?.debtToAssets ?? null,
    };
  }
}
