import { describe, expect, it } from 'vitest';
import { summarizeCrossMarketBenchmarkPit, summarizeExternalMarketPit } from './audit.js';

describe('market data audit', () => {
  it('audits external drivers against the next China market session', () => {
    expect(
      summarizeExternalMarketPit(
        [
          {
            seriesKey: 'us_treasury_nominal',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
          {
            seriesKey: 'us_treasury_real',
            tradeDate: '20260731',
            availableDate: '20260803',
            validValue: true,
          },
          {
            seriesKey: 'USDCNH.FXCM',
            tradeDate: '20260730',
            availableDate: '20260730',
            validValue: false,
          },
          {
            seriesKey: 'USDHKD.FXCM',
            tradeDate: '20260730',
            availableDate: '20260731',
            validValue: true,
          },
        ],
        new Set(['20260731', '20260803']),
      ),
    ).toEqual({
      missingSeries: [],
      invalidAvailabilityRows: 1,
      nonTradingAvailabilityRows: 1,
      invalidValueRows: 1,
      latestAvailableDate: '20260803',
    });
  });
  it('applies the local-close and strictly-later cross-market availability rules separately', () => {
    expect(
      summarizeCrossMarketBenchmarkPit(
        [
          {
            benchmarkId: 'equity.cn.csi300.price',
            market: 'CN',
            tradeDate: '20260730',
            availableDate: '20260730',
            close: 4500,
          },
          {
            benchmarkId: 'equity.hk.hsi.price',
            market: 'HK',
            tradeDate: '20260730',
            availableDate: '20260731',
            close: 25000,
          },
          {
            benchmarkId: 'equity.us.spx.price',
            market: 'US',
            tradeDate: '20260730',
            availableDate: '20260731',
            close: 7000,
          },
        ],
        new Set(['20260730', '20260731']),
      ),
    ).toEqual({
      missingBenchmarks: [],
      invalidAvailabilityRows: 0,
      nonTradingAvailabilityRows: 0,
      invalidValueRows: 0,
      latestAvailableByBenchmark: {
        'equity.cn.csi300.price': '20260730',
        'equity.hk.hsi.price': '20260731',
        'equity.us.spx.price': '20260731',
      },
    });
  });
});
