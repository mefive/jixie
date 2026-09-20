import type {
  AssetFactorV2,
  CustomFactor,
  FactorCtx,
  FactorV2Field,
  TimeSeriesFactorCtxV2,
} from '@jixie/shared/sdk/factor/contract';

/** Evaluated inside the isolate; the runtime installs this factory as a user global. */
export function defineFactor(factor: CustomFactor): CustomFactor {
  return factor;
}

/** Evaluated inside the isolate for asset-scope definitions. */
export function defineFactorV2(factor: AssetFactorV2): AssetFactorV2 {
  return factor;
}

/** Prepared, aligned histories supplied by the host; no SDK method loads data itself. */
export interface FactorHistory {
  closes?: number[]; // tail window ending at the evaluation day (windowed factors only)
  dates?: string[]; // aligned trade dates for the window
  amounts?: (number | null)[]; // aligned daily turnover amounts (thousand yuan)
  turnoverRatesF?: (number | null)[]; // aligned free-float turnover rates for the window
  roes?: (number | null)[]; // aligned point-in-time ROE values (as-of announcement date)
  grossProfitMargins?: (number | null)[]; // aligned point-in-time gross margins
  marketCloses?: (number | null)[]; // aligned exact-date CSI All Share closes
}

/** Cross-sectional history methods over one point-in-time host snapshot. */
export class CrossSectionalFactorContext implements FactorCtx {
  readonly #snapshot: FactorHistory;

  constructor(snapshot: FactorHistory) {
    this.#snapshot = snapshot;

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
    const snapshot = this.#snapshot;
    if (!snapshot.closes) {
      throw new Error('要用 ctx.history 需在 defineFactor 里声明 window(所需交易日数,含当天)');
    }

    let source: number[] | string[] | (number | null)[] | undefined;
    switch (field) {
      case 'date':
        source = snapshot.dates;
        break;
      case 'amount':
        source = snapshot.amounts;
        break;
      case 'turnoverRateF':
        source = snapshot.turnoverRatesF;
        break;
      case 'roe':
        source = snapshot.roes;
        break;
      case 'grossprofitMargin':
        source = snapshot.grossProfitMargins;
        break;
      case 'marketClose':
        source = snapshot.marketCloses;
        break;
      default:
        source = snapshot.closes;
    }

    // Missing declared arrays still fail inside the per-item runtime error boundary.
    if (periods <= 0 || source!.length < periods) {
      return [];
    }
    return source!.slice(source!.length - periods);
  }
}

/** The runtime shares the declared-input set across a batch; values remain index-local. */
export class AssetFactorContext implements TimeSeriesFactorCtxV2 {
  readonly #fields: Partial<Record<string, number[]>>;
  readonly #index: number;
  readonly #declaredInputs: ReadonlySet<string>;

  constructor(
    fields: Partial<Record<string, number[]>>,
    index: number,
    declaredInputs: ReadonlySet<string>,
  ) {
    this.#fields = fields;
    this.#index = index;
    this.#declaredInputs = declaredInputs;
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
    if (!this.#declaredInputs.has(field)) {
      throw new Error('Factor code accessed undeclared input ' + field);
    }
    if (!Number.isInteger(periods) || periods < 0) {
      throw new Error('ctx.lag periods must be a non-negative integer');
    }
    const values = this.#fields[field];
    const value = values && values[this.#index - periods];
    return Number.isFinite(value) ? value! : null;
  }
}
