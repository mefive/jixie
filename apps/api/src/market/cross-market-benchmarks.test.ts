import { describe, expect, it } from 'vitest';
import {
  CROSS_MARKET_BENCHMARKS,
  deriveBenchmarkCnyCloses,
  deriveHkdCnhMidCloses,
  parseCrossMarketBenchmarkRows,
} from './cross-market-benchmarks.js';

const hsi = CROSS_MARKET_BENCHMARKS.find((benchmark) => benchmark.market === 'HK')!;

describe('cross-market benchmark normalization', () => {
  it('keeps the provider session identity and price-index semantics', () => {
    expect(
      parseCrossMarketBenchmarkRows(
        hsi,
        [
          {
            ts_code: 'HSI',
            trade_date: '20260724',
            open: 24932.5,
            high: 25031.34,
            low: 24812.5,
            close: 24963.23,
            pre_close: 25210.81,
            change: -247.58,
            pct_chg: -0.982,
            swing: 0.87,
            vol: 247340,
          },
        ],
        '20260724',
        '20260724',
      ),
    ).toEqual([
      {
        benchmarkId: 'equity.hk.hsi.price',
        tradeDate: '20260724',
        open: 24932.5,
        high: 25031.34,
        low: 24812.5,
        close: 24963.23,
        preClose: 25210.81,
        change: -247.58,
        pctChange: -0.982,
        swing: 0.87,
        volume: 247340,
      },
    ]);
  });

  it('rejects a benchmark bar whose close lies outside the daily range', () => {
    expect(() =>
      parseCrossMarketBenchmarkRows(
        hsi,
        [
          {
            ts_code: 'HSI',
            trade_date: '20260724',
            high: 25000,
            low: 24000,
            close: 26000,
          },
        ],
        '20260724',
        '20260724',
      ),
    ).toThrow('invalid bar');
  });

  it('preserves a documented sub-tick historical OHLC rounding disagreement', () => {
    const spx = CROSS_MARKET_BENCHMARKS.find((benchmark) => benchmark.market === 'US')!;
    expect(
      parseCrossMarketBenchmarkRows(
        spx,
        [
          {
            ts_code: 'SPX',
            trade_date: '20080929',
            open: 1209.0699,
            high: 1209.0699,
            low: 1106.42,
            close: 1106.39,
            pre_close: 1213.01,
          },
        ],
        '20080929',
        '20080929',
      )[0]!.close,
    ).toBe(1106.39);
  });

  it('does not impose a single-instrument open invariant on a staggered-opening index', () => {
    const spx = CROSS_MARKET_BENCHMARKS.find((benchmark) => benchmark.market === 'US')!;
    expect(
      parseCrossMarketBenchmarkRows(
        spx,
        [
          {
            ts_code: 'SPX',
            trade_date: '20240216',
            open: 4976.44,
            high: 5038.7,
            low: 4999.52,
            close: 5005.57,
            pre_close: 5029.73,
          },
        ],
        '20240216',
        '20240216',
      )[0]!.open,
    ).toBe(4976.44);
  });

  it('splits HKD-to-CNY conversion into the two audited FX legs', () => {
    const fxRows = [
      fx('USDCNH.FXCM', '20260723', 6.75),
      fx('USDHKD.FXCM', '20260723', 7.84),
      fx('USDCNH.FXCM', '20260724', 6.8),
      fx('USDHKD.FXCM', '20260724', 7.85),
    ];
    const result = deriveBenchmarkCnyCloses(
      hsi,
      [
        { availableDate: '20260723', close: 25000 },
        { availableDate: '20260724', close: 25200 },
      ],
      fxRows,
    );

    expect(result.missingFxDates).toEqual([]);
    expect(result.points[0]!.value).toBeCloseTo((25000 * 6.75) / 7.84);
    expect(result.points[1]!.value).toBeCloseTo((25200 * 6.8) / 7.85);
    expect(deriveHkdCnhMidCloses(fxRows, '20260723', '20260724')).toEqual([
      { date: '20260723', value: 6.75 / 7.84 },
      { date: '20260724', value: 6.8 / 7.85 },
    ]);
  });

  it('excludes a base-currency observation until every required FX leg is available', () => {
    expect(
      deriveBenchmarkCnyCloses(
        hsi,
        [{ availableDate: '20260723', close: 25000 }],
        [fx('USDCNH.FXCM', '20260723', 6.75)],
      ),
    ).toEqual({ points: [], missingFxDates: ['20260723'] });
  });

  it('uses the latest source FX session when multiple bars share one post-holiday availability date', () => {
    const result = deriveBenchmarkCnyCloses(
      hsi,
      [{ availableDate: '20260224', close: 25000 }],
      [
        fx('USDCNH.FXCM', '20260213', 6.7, '20260224'),
        fx('USDCNH.FXCM', '20260223', 6.8, '20260224'),
        fx('USDHKD.FXCM', '20260213', 7.83, '20260224'),
        fx('USDHKD.FXCM', '20260223', 7.85, '20260224'),
      ],
    );

    expect(result.points[0]!.value).toBeCloseTo((25000 * 6.8) / 7.85);
  });

  it('does not carry an FX quote forward for more than seven calendar days', () => {
    expect(
      deriveBenchmarkCnyCloses(
        hsi,
        [{ availableDate: '20260723', close: 25000 }],
        [fx('USDCNH.FXCM', '20260701', 6.75), fx('USDHKD.FXCM', '20260701', 7.84)],
      ),
    ).toEqual({ points: [], missingFxDates: ['20260723'] });
  });
});

function fx(tsCode: string, tradeDate: string, mid: number, availableDate = tradeDate) {
  return { tsCode, tradeDate, availableDate, bidClose: mid - 0.0001, askClose: mid + 0.0001 };
}
