import { describe, expect, it, vi } from 'vitest';
import {
  assignExternalAvailableDates,
  parseExternalFxRows,
  parseExternalYieldCurveRows,
  parseUsdCnhRows,
} from './external-market-drivers.js';

describe('external market driver normalization', () => {
  it('normalizes all disclosed US curve tenors without interpolating missing points', () => {
    expect(
      parseExternalYieldCurveRows(
        [
          {
            date: '20260730',
            m1: null,
            m2: null,
            m3: null,
            m6: null,
            y1: null,
            y2: null,
            y3: null,
            y5: null,
            y7: null,
            y10: null,
            y20: null,
            y30: null,
          },
          {
            date: '20260731',
            m1: 3.78,
            m2: null,
            m3: 3.83,
            m6: 3.98,
            y1: 4.08,
            y2: 4.28,
            y3: 4.34,
            y5: 4.45,
            y7: 4.59,
            y10: 4.75,
            y20: 5.28,
            y30: 5.27,
          },
        ],
        'nominal',
        '20260701',
        '20260731',
      ),
    ).toEqual([
      { tradeDate: '20260731', termYears: 1 / 12, yieldPct: 3.78 },
      { tradeDate: '20260731', termYears: 0.25, yieldPct: 3.83 },
      { tradeDate: '20260731', termYears: 0.5, yieldPct: 3.98 },
      { tradeDate: '20260731', termYears: 1, yieldPct: 4.08 },
      { tradeDate: '20260731', termYears: 2, yieldPct: 4.28 },
      { tradeDate: '20260731', termYears: 3, yieldPct: 4.34 },
      { tradeDate: '20260731', termYears: 5, yieldPct: 4.45 },
      { tradeDate: '20260731', termYears: 7, yieldPct: 4.59 },
      { tradeDate: '20260731', termYears: 10, yieldPct: 4.75 },
      { tradeDate: '20260731', termYears: 20, yieldPct: 5.28 },
      { tradeDate: '20260731', termYears: 30, yieldPct: 5.27 },
    ]);
  });

  it('normalizes the five published real-yield tenors', () => {
    expect(
      parseExternalYieldCurveRows(
        [{ date: '20260731', y5: 2.19, y7: 2.32, y10: 2.47, y20: 2.82, y30: 3.03 }],
        'real',
        '20260731',
        '20260731',
      ).map((point) => [point.termYears, point.yieldPct]),
    ).toEqual([
      [5, 2.19],
      [7, 2.32],
      [10, 2.47],
      [20, 2.82],
      [30, 3.03],
    ]);
  });

  it('preserves raw USD/CNH bid/ask bars and rejects inverted quotes', () => {
    const row = {
      ts_code: 'USDCNH.FXCM',
      trade_date: '20260730',
      bid_open: 6.74773,
      bid_close: 6.75232,
      bid_high: 6.75509,
      bid_low: 6.74196,
      ask_open: 6.7486,
      ask_close: 6.75371,
      ask_high: 6.7557,
      ask_low: 6.74258,
      tick_qty: 140278,
    };

    expect(parseUsdCnhRows([row], '20260701', '20260731')).toEqual([
      {
        tsCode: 'USDCNH.FXCM',
        tradeDate: '20260730',
        exchange: 'FXCM',
        bidOpen: 6.74773,
        bidClose: 6.75232,
        bidHigh: 6.75509,
        bidLow: 6.74196,
        askOpen: 6.7486,
        askClose: 6.75371,
        askHigh: 6.7557,
        askLow: 6.74258,
        tickQty: 140278,
      },
    ]);
    expect(() => parseUsdCnhRows([{ ...row, bid_close: 6.8 }], '20260701', '20260731')).toThrow(
      'invalid quotes',
    );
  });

  it('normalizes the separately declared USD/HKD conversion leg', () => {
    expect(
      parseExternalFxRows(
        [
          {
            ts_code: 'USDHKD.FXCM',
            trade_date: '20260730',
            bid_open: 7.84,
            bid_close: 7.841,
            bid_high: 7.842,
            bid_low: 7.839,
            ask_open: 7.841,
            ask_close: 7.842,
            ask_high: 7.843,
            ask_low: 7.84,
            tick_qty: 12000,
          },
        ],
        'USDHKD.FXCM',
        '20260701',
        '20260731',
      ),
    ).toEqual([
      {
        tsCode: 'USDHKD.FXCM',
        tradeDate: '20260730',
        exchange: 'FXCM',
        bidOpen: 7.84,
        bidClose: 7.841,
        bidHigh: 7.842,
        bidLow: 7.839,
        askOpen: 7.841,
        askClose: 7.842,
        askHigh: 7.843,
        askLow: 7.84,
        tickQty: 12000,
      },
    ]);
  });

  it('gates US-close data on the first strictly later SSE session', () => {
    expect(
      assignExternalAvailableDates(
        [
          { tradeDate: '20260730', value: 1 },
          { tradeDate: '20260731', value: 2 },
        ],
        ['20260730', '20260731', '20260803'],
      ),
    ).toEqual([
      { tradeDate: '20260730', value: 1, availableDate: '20260731' },
      { tradeDate: '20260731', value: 2, availableDate: '20260803' },
    ]);
  });

  it('can quarantine a one-pip historical rounding inversion without accepting larger errors', () => {
    const warning = vi.fn();
    const roundingInversion = {
      ts_code: 'USDHKD.FXCM',
      trade_date: '20070727',
      bid_open: 7.822,
      bid_close: 7.8242,
      bid_high: 7.8245,
      bid_low: 7.8203,
      ask_open: 7.8219,
      ask_close: 7.8264,
      ask_high: 7.8265,
      ask_low: 7.8219,
      tick_qty: 948,
    };

    expect(
      parseExternalFxRows([roundingInversion], 'USDHKD.FXCM', '20070101', '20071231', {
        skipRoundingInversions: true,
        onWarning: warning,
      }),
    ).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      'Skipped USDHKD.FXCM 20070727: bid/ask rounding inversion 0.0001',
    );
    expect(() =>
      parseExternalFxRows(
        [{ ...roundingInversion, bid_open: 7.823 }],
        'USDHKD.FXCM',
        '20070101',
        '20071231',
        { skipRoundingInversions: true },
      ),
    ).toThrow('invalid quotes');
  });
});
