import type { StrategyCapabilities, StrategyDefinition } from './capabilities.js';
import type {
  BarRow,
  CodeStrategy,
  OhlcBar,
  Schedule,
  StrategyCtx,
  StrategyParams,
  StrategyParamValue,
} from '@jixie/shared/sdk/strategy/contract';
import { isoWeekKey } from '#date';
import {
  adx as calculateAdx,
  adxLookback,
  bollingerBands as calculateBollingerBands,
  kdjLookback,
  latestKdj,
  macd as calculateMacd,
  macdLookback,
  rsi as calculateRsi,
  rsiLookback,
  type AdxResult,
  type BollingerBandsResult,
  type KdjResult,
  type MacdResult,
} from '#math/indicators.js';
import { createStockAccount } from './stock-account.js';
import { Universe } from './universe.js';
import { ResampledSeries } from './timeframe-series.js';
import { smaValues, emaValues, atrBars, extremeValues, avgField } from './indicators.js';

/** Normalize a public definition; the runner constructs the context before invoking its callback. */
export function defineStrategy<const Params extends StrategyParams = Record<string, never>>(
  definition: CodeStrategy<Params>,
): StrategyDefinition {
  return {
    name: definition.name ?? '未命名策略',
    params: normalizeStrategyParams(definition.params),
    factors: definition.factors,
    watch: definition.watch,
    accounts: definition.accounts,
    // Preserve the author's callback receiver without constructing its context here.
    onBar: (context: StrategyCtx<Params>) => definition.onBar(context),
  };
}

/** Public Strategy methods over injected primitives, independently of the execution environment. */
export class StrategyContext<
  Params extends StrategyParams = StrategyParams,
> implements StrategyCtx<Params> {
  readonly #capabilities: StrategyCapabilities;
  readonly date: string;
  readonly params: StrategyCtx<Params>['params'];
  readonly portfolio: StrategyCtx<Params>['portfolio'];
  readonly stock: StrategyCtx<Params>['stock'];
  readonly futures: StrategyCtx<Params>['futures'];

  constructor(capabilities: StrategyCapabilities, params = {} as Params) {
    this.#capabilities = capabilities;
    this.date = capabilities.date;
    this.params = Object.freeze({ ...params }) as StrategyCtx<Params>['params'];
    Object.defineProperty(this, 'params', { writable: false });

    this.portfolio = capabilities.portfolio;
    this.stock = createStockAccount(capabilities);
    this.futures = capabilities.futures;

    // Preserve the detached, enumerable methods of the previous object-based context.
    this.bar = this.bar.bind(this);
    this.bars = this.bars.bind(this);
    this.ensureBars = this.ensureBars.bind(this);
    this.listDays = this.listDays.bind(this);
    this.industry = this.industry.bind(this);
    this.lhbNet = this.lhbNet.bind(this);
    this.price = this.price.bind(this);
    this.history = this.history.bind(this);
    this.factor = this.factor.bind(this);
    this.indexMembers = this.indexMembers.bind(this);
    this.index = this.index.bind(this);
    this.future = this.future.bind(this);
    this.futureHistory = this.futureHistory.bind(this);
    this.period = this.period.bind(this);
    this.universe = this.universe.bind(this);
    this.weekly = this.weekly.bind(this);
    this.monthly = this.monthly.bind(this);
    this.sma = this.sma.bind(this);
    this.ema = this.ema.bind(this);
    this.highest = this.highest.bind(this);
    this.lowest = this.lowest.bind(this);
    this.atr = this.atr.bind(this);
    this.avgAmount = this.avgAmount.bind(this);
    this.avgVol = this.avgVol.bind(this);
    this.adx = this.adx.bind(this);
    this.bollingerBands = this.bollingerBands.bind(this);
    this.rsi = this.rsi.bind(this);
    this.macd = this.macd.bind(this);
    this.kdj = this.kdj.bind(this);
  }

  bar(code: string): BarRow | null {
    return this.#capabilities.bar(code);
  }

  bars(code: string, count: number): OhlcBar[] {
    return this.#capabilities.bars(code, count);
  }

  ensureBars(codes: string[]): Promise<void> {
    return this.#capabilities.ensureBars(codes);
  }

  listDays(code: string): number | null {
    return this.#capabilities.listDays(code);
  }

  industry(code: string): string | null {
    return this.#capabilities.industry(code);
  }

  lhbNet(code: string): number | null {
    return this.#capabilities.lhbNet(code);
  }

  price(code: string): number | null {
    return this.#capabilities.price(code);
  }

  history(code: string, field: 'open' | 'high' | 'low' | 'close', count: number): number[] {
    return this.#capabilities.history(code, field, count);
  }

  factor(name: string, code: string): number | null {
    return this.#capabilities.factor(name, code);
  }

  indexMembers(indexCode: string): Promise<string[]> {
    return this.#capabilities.indexMembers(indexCode);
  }

  index(indexCode: string): ReturnType<StrategyCapabilities['index']> {
    return this.#capabilities.index(indexCode);
  }

  future(code: string): ReturnType<StrategyCapabilities['future']> {
    return this.#capabilities.future(code);
  }

  futureHistory(
    code: string,
    field: Parameters<StrategyCapabilities['futureHistory']>[1],
    count: number,
  ): number[] {
    return this.#capabilities.futureHistory(code, field, count);
  }

  period(schedule: Schedule): string {
    return periodKey(this.#capabilities.date, schedule);
  }

  async universe(indexCode?: string): Promise<Universe> {
    const codes = await this.#capabilities.loadCrossSection(indexCode);

    return new Universe(this.#capabilities, codes);
  }

  weekly(code: string): ResampledSeries {
    return new ResampledSeries(this.#capabilities, code, 'weekly');
  }

  monthly(code: string): ResampledSeries {
    return new ResampledSeries(this.#capabilities, code, 'monthly');
  }

  sma(code: string, periods: number): number | null {
    return smaValues(this.#capabilities.history(code, 'close', periods), periods);
  }

  ema(code: string, periods: number): number | null {
    return emaValues(this.#capabilities.history(code, 'close', periods * 4), periods);
  }

  highest(code: string, field: 'open' | 'high' | 'low' | 'close', periods: number): number | null {
    return extremeValues(this.#capabilities.history(code, field, periods), periods, Math.max);
  }

  lowest(code: string, field: 'open' | 'high' | 'low' | 'close', periods: number): number | null {
    return extremeValues(this.#capabilities.history(code, field, periods), periods, Math.min);
  }

  atr(code: string, periods: number): number | null {
    return atrBars(this.#capabilities.bars(code, periods + 1), periods);
  }

  avgAmount(code: string, periods: number): number | null {
    return avgField(this.#capabilities.bars(code, periods), periods, (bar) => bar.amount);
  }

  avgVol(code: string, periods: number): number | null {
    return avgField(this.#capabilities.bars(code, periods), periods, (bar) => bar.vol);
  }

  adx(code: string, period = 14): AdxResult | null {
    return calculateAdx(this.#capabilities.bars(code, adxLookback(period)), period);
  }

  bollingerBands(code: string, period = 20, standardDeviations = 2): BollingerBandsResult | null {
    return calculateBollingerBands(
      this.#capabilities.history(code, 'close', period),
      period,
      standardDeviations,
    );
  }

  rsi(code: string, period = 14): number | null {
    return calculateRsi(this.#capabilities.history(code, 'close', rsiLookback(period)), period);
  }

  macd(code: string, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult | null {
    return calculateMacd(
      this.#capabilities.history(code, 'close', macdLookback(fastPeriod, slowPeriod, signalPeriod)),
      fastPeriod,
      slowPeriod,
      signalPeriod,
    );
  }

  kdj(code: string, period = 9, kSmoothing = 3, dSmoothing = 3): KdjResult | null {
    return latestKdj(
      this.#capabilities.bars(code, kdjLookback(period)),
      period,
      kSmoothing,
      dSmoothing,
    );
  }
}

export function applyStrategyParamOverrides(
  strategy: Pick<StrategyDefinition, 'params'>,
  overrides?: Record<string, StrategyParamValue>,
): void {
  if (!overrides) {
    return;
  }
  const declared = strategy.params ?? {};
  const merged = { ...declared };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in declared)) {
      throw new Error(`unknown strategy parameter: ${key}`);
    }
    if (typeof value !== typeof declared[key]) {
      throw new Error(`strategy parameter ${key} override must match its declared type`);
    }
    if (!validParamValue(value)) {
      throw new Error(`strategy parameter ${key} must be a finite number or non-empty string`);
    }
    merged[key] = value;
  }
  strategy.params = merged;
}

function normalizeStrategyParams(params?: StrategyParams): StrategyParams {
  const normalized: StrategyParams = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!key.trim() || !validParamValue(value)) {
      throw new Error('strategy params must use non-empty keys and finite numbers or strings');
    }
    normalized[key] = value;
  }
  return normalized;
}

function validParamValue(value: StrategyParamValue): boolean {
  return typeof value === 'number'
    ? Number.isFinite(value)
    : value.trim().length > 0 && value.length <= 100;
}

/** Period bucket for a schedule — a new key means a new period (rebalance boundary). */
export function periodKey(date: string, schedule: Schedule): string {
  if (schedule === 'monthly') {
    return date.slice(0, 6);
  } // YYYYMM
  if (schedule === 'weekly') {
    return isoWeekKey(date);
  }
  return date; // daily: each trading day is its own key
}
