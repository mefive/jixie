import type { CrossSectionalFactorCapabilities, AssetFactorCapabilities } from './capabilities.js';
import type {
  AssetFactorV2,
  CustomFactor,
  FactorCtx,
  FactorV2Field,
  TimeSeriesFactorCtxV2,
} from '@jixie/shared/sdk/factor/contract';

/** Passed into the user-code evaluator inside the isolate for cross-sectional definitions. */
export function defineFactor(factor: CustomFactor): CustomFactor {
  return factor;
}

/** Passed into the user-code evaluator inside the isolate for asset-scope definitions. */
export function defineFactorV2(factor: AssetFactorV2): AssetFactorV2 {
  return factor;
}

/** Cross-sectional history methods over one point-in-time host snapshot. */
export class CrossSectionalFactorContext implements FactorCtx {
  readonly #capabilities: CrossSectionalFactorCapabilities;

  constructor(capabilities: CrossSectionalFactorCapabilities) {
    this.#capabilities = capabilities;

    // Preserve detached calls supported by the previous closure-based context.
    this.history = this.history.bind(this);
  }

  history(periods: number): number[];
  history(periods: number, field: 'date'): string[];
  history(periods: number, field: 'amount'): (number | null)[];
  history(periods: number, field: 'turnoverRateF'): (number | null)[];
  history(periods: number, field: 'roe'): (number | null)[];
  history(periods: number, field: 'grossprofitMargin'): (number | null)[];
  history(periods: number, field: 'marketClose'): (number | null)[];
  history(periods: number, field?: string): number[] | string[] | (number | null)[] {
    if (!this.#capabilities.hasHistory) {
      throw new Error('要用 ctx.history 需在 defineFactor 里声明 window(所需交易日数,含当天)');
    }

    const source = this.#capabilities.historyValues(field);

    // Missing declared arrays still fail inside the per-item runtime error boundary.
    if (periods <= 0 || source!.length < periods) {
      return [];
    }
    return source!.slice(source!.length - periods);
  }
}

/** The runtime shares the declared-input set across a batch; values remain index-local. */
export class AssetFactorContext implements TimeSeriesFactorCtxV2 {
  readonly #capabilities: AssetFactorCapabilities;

  constructor(capabilities: AssetFactorCapabilities) {
    this.#capabilities = capabilities;
    this.value = this.value.bind(this);
    this.lag = this.lag.bind(this);
  }

  value(field: FactorV2Field): number | null {
    return this.#access(field, 0);
  }

  lag(field: FactorV2Field, periods: number): number | null {
    return this.#access(field, periods);
  }

  #access(field: string, periods: number): number | null {
    if (!this.#capabilities.declaresInput(field)) {
      throw new Error('Factor code accessed undeclared input ' + field);
    }
    if (!Number.isInteger(periods) || periods < 0) {
      throw new Error('ctx.lag periods must be a non-negative integer');
    }
    const value = this.#capabilities.valueAt(field, periods);
    return Number.isFinite(value) ? value! : null;
  }
}
