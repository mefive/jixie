import { describe, expect, it, vi } from 'vitest';
import { EngineData } from './engine-data.js';
import { fixturePort } from '../testing/fixture-port.js';

const date = '20240102';

function dataFixture() {
  return fixturePort({
    dates: [date],
    stocks: ['A', 'B', 'C'].map((code) => ({
      code,
      bars: [{ date, open: 10, close: 11, turnoverRateF: 2 }],
    })),
    finaIndicators: [
      {
        tsCode: 'A',
        annDate: date,
        roe: 12,
        roeWaa: null,
        roa: null,
        grossprofitMargin: 30,
        debtToAssets: null,
      },
    ],
    yieldCurvePoints: [{ availableDate: date, termYears: 10, yieldPct: 3 }],
  });
}

describe('initial data loading', () => {
  it('loads requested data in order and preserves cached and dynamic bar reads', async () => {
    const dataPort = dataFixture();
    const yields = vi.spyOn(dataPort, 'yieldCurvePoints');
    const bars = vi.spyOn(dataPort, 'barsRows');
    const fundamentals = vi.spyOn(dataPort, 'finaIndicators');
    const data = new EngineData({
      start: date,
      end: date,
      dataPort,
      preloadCodes: ['A', 'B', 'A'],
      requirements: {
        turnoverRateFHistory: true,
        fundamentalHistory: true,
        governmentYieldCurve: true,
      },
    });

    await data.load();

    expect(bars.mock.calls).toEqual([
      [['A', 'B'], date, date, { includeTurnoverRateF: true }],
    ]);
    expect(yields.mock.invocationCallOrder[0]).toBeLessThan(bars.mock.invocationCallOrder[0]);
    expect(bars.mock.invocationCallOrder[0]).toBeLessThan(fundamentals.mock.invocationCallOrder[0]);
    expect(data.loadedBarCodes()).toEqual(['A', 'B']);
    expect(data.adjustedCloseAsOf('B', date)).toBe(11);
    expect(data.roeHistoryAt('A', date)).toBe(12);
    expect(data.grossProfitMarginHistoryAt('A', date)).toBe(30);
    expect(data.governmentYieldAsOf(10, date)).toBe(3);

    await data.loadBars(['A', 'B', 'C']);

    expect(bars).toHaveBeenCalledTimes(2);
    expect(bars).toHaveBeenLastCalledWith(['C'], date, date, { includeTurnoverRateF: true });
    expect(data.adjustedCloseAsOf('C', date)).toBe(11);
    expect(fundamentals).toHaveBeenCalledTimes(1);
  });

  it('keeps optional data unloaded by default and supports later bar loading', async () => {
    const dataPort = dataFixture();
    const yields = vi.spyOn(dataPort, 'yieldCurvePoints');
    const bars = vi.spyOn(dataPort, 'barsRows');
    const fundamentals = vi.spyOn(dataPort, 'finaIndicators');
    const data = new EngineData({ start: date, end: date, dataPort });

    await data.load();

    expect(yields).not.toHaveBeenCalled();
    expect(bars).not.toHaveBeenCalled();
    expect(fundamentals).not.toHaveBeenCalled();

    await data.loadBars(['A']);

    expect(bars).toHaveBeenCalledWith(['A'], date, date, { includeTurnoverRateF: false });
    expect(data.adjustedCloseAsOf('A', date)).toBe(11);
  });

  it('rejects initialization if fundamentals fail after preloading bars', async () => {
    const dataPort = dataFixture();
    const bars = vi.spyOn(dataPort, 'barsRows');
    const failure = new Error('Financial data unavailable');
    vi.spyOn(dataPort, 'finaIndicators').mockRejectedValue(failure);

    const data = new EngineData({
      start: date,
      end: date,
      dataPort,
      preloadCodes: ['A', 'B'],
      requirements: {
        turnoverRateFHistory: false,
        fundamentalHistory: true,
        governmentYieldCurve: false,
      },
    });

    await expect(data.load()).rejects.toBe(failure);

    expect(bars).toHaveBeenCalledTimes(1);
    expect(bars).toHaveBeenCalledWith(['A', 'B'], date, date, { includeTurnoverRateF: false });
    expect(data.loadedBarCodes()).toEqual(['A', 'B']);
  });
});
