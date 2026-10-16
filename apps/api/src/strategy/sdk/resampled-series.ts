import type { StrategyCapabilities } from './capabilities.js';
import type { OhlcBar, TimeframeSeries } from '@jixie/shared/sdk/strategy/contract';
import { smaValues, emaValues, atrBars, extremeValues, avgField, ohlcField } from './indicators.js';
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

export class ResampledSeries implements TimeframeSeries {
  constructor(
    private readonly capabilities: StrategyCapabilities,
    private readonly code: string,
    private readonly period: 'weekly' | 'monthly',
  ) {}

  bars(n: number): OhlcBar[] {
    return this.capabilities.resampledBars(this.code, this.period, n);
  }

  history(field: 'open' | 'high' | 'low' | 'close', n: number): number[] {
    return this.bars(n).map((bar) => ohlcField(bar, field));
  }

  sma(n: number): number | null {
    return smaValues(this.history('close', n), n);
  }

  ema(n: number): number | null {
    return emaValues(this.history('close', n * 4), n);
  }

  atr(n: number): number | null {
    return atrBars(this.bars(n + 1), n);
  }

  highest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null {
    return extremeValues(this.history(field, n), n, Math.max);
  }

  lowest(field: 'open' | 'high' | 'low' | 'close', n: number): number | null {
    return extremeValues(this.history(field, n), n, Math.min);
  }

  avgAmount(n: number): number | null {
    return avgField(this.bars(n), n, (bar) => bar.amount);
  }

  avgVol(n: number): number | null {
    return avgField(this.bars(n), n, (bar) => bar.vol);
  }

  adx(period = 14): AdxResult | null {
    return calculateAdx(this.bars(adxLookback(period)), period);
  }

  bollingerBands(period = 20, standardDeviations = 2): BollingerBandsResult | null {
    return calculateBollingerBands(this.history('close', period), period, standardDeviations);
  }

  rsi(period = 14): number | null {
    return calculateRsi(this.history('close', rsiLookback(period)), period);
  }

  macd(fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult | null {
    return calculateMacd(
      this.history('close', macdLookback(fastPeriod, slowPeriod, signalPeriod)),
      fastPeriod,
      slowPeriod,
      signalPeriod,
    );
  }

  kdj(period = 9, kSmoothing = 3, dSmoothing = 3): KdjResult | null {
    return latestKdj(this.bars(kdjLookback(period)), period, kSmoothing, dSmoothing);
  }
}
