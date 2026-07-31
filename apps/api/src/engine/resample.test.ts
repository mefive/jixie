import { DEFAULT_LOCALE } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { EngineData } from './data.js';
import { fixturePort, type FixtureBar, type FixtureSpec } from './fixture-port.js';

const dates = [
  '20231227',
  '20231228',
  '20231229',
  '20240102',
  '20240103',
  '20240104',
  '20240105',
  '20240108',
  '20240109',
  '20240110',
  '20240111',
  '20240112',
  '20240129',
  '20240130',
  '20240131',
  '20240201', // calendar-only lookahead beyond the backtest end
];

const bars: FixtureBar[] = [
  {
    date: '20231227',
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    vol: 100,
    amount: 1000,
    turnoverRateF: 1,
  },
  { date: '20231228', open: 11, high: 13, low: 10, close: 12, amount: 2000 },
  { date: '20231229', open: 12, high: 14, low: 11, close: 13, vol: 300, turnoverRateF: 3 },
  { date: '20240102', open: 20, high: 22, low: 19, close: 21, vol: 10, amount: 100 },
  { date: '20240103', open: 21, high: 23, low: 20, close: 22, vol: 20, amount: 200 },
  { date: '20240104', open: 22, high: 24, low: 18, close: 23, vol: 30, amount: 300 },
  // A is suspended on the market's final trading day 20240105; the week must still close that day.
  { date: '20240108', open: 30, high: 32, low: 29, close: 31, vol: 40, amount: 400 },
  { date: '20240112', open: 31, high: 35, low: 28, close: 34, vol: 50, amount: 500 },
  { date: '20240129', open: 40, high: 43, low: 39, close: 42, vol: 60, amount: 600 },
  { date: '20240130', open: 42, high: 44, low: 38, close: 41, vol: 70, amount: 700 },
  { date: '20240131', open: 41, high: 45, low: 40, close: 44, vol: 80, amount: 800 },
  // Must never enter a January run's aggregate; only the calendar date is needed.
  { date: '20240201', open: 999, high: 999, low: 999, close: 999, vol: 999, amount: 999 },
];

const spec: FixtureSpec = { dates, stocks: [{ code: 'A', bars }] };

async function loadedData(): Promise<EngineData> {
  const data = new EngineData(
    '20231227',
    '20240131',
    [],
    () => {},
    DEFAULT_LOCALE,
    fixturePort(spec),
    [],
    true,
  );
  await data.load();
  await data.loadBars(['A']);
  return data;
}

describe('daily bar resampling', () => {
  it('aggregates exact ISO-week OHLC and nullable volume fields', async () => {
    const data = await loadedData();

    expect(data.resampledBars('A', '20231228', 'weekly', 2)).toEqual([]);
    expect(data.resampledBars('A', '20231229', 'weekly', 2)).toEqual([
      {
        date: '20231229',
        adjOpen: 10,
        adjHigh: 14,
        adjLow: 9,
        adjClose: 13,
        vol: 400,
        amount: 3000,
        turnoverRateF: 2,
      },
    ]);
  });

  it('hides the partial current week, then closes a holiday/suspension-shortened week', async () => {
    const data = await loadedData();

    expect(data.resampledBars('A', '20240103', 'weekly', 5).map((bar) => bar.date)).toEqual([
      '20231229',
    ]);
    expect(data.resampledBars('A', '20240105', 'weekly', 5).map((bar) => bar.date)).toEqual([
      '20231229',
      '20240104',
    ]);
  });

  it('exposes a natural month only after the market calendar crosses month-end', async () => {
    const data = await loadedData();

    expect(data.resampledBars('A', '20240130', 'monthly', 5).map((bar) => bar.date)).toEqual([
      '20231229',
    ]);
    const months = data.resampledBars('A', '20240131', 'monthly', 5);
    expect(months.map((bar) => bar.date)).toEqual(['20231229', '20240131']);
    expect(months[1]).toMatchObject({
      adjOpen: 20,
      adjHigh: 45,
      adjLow: 18,
      adjClose: 44,
      vol: 360,
      amount: 3600,
    });
    expect(months[1].adjHigh).not.toBe(999);
  });

  it('returns no higher-timeframe data until the instrument series is loaded', async () => {
    const data = new EngineData(
      '20231227',
      '20240131',
      [],
      () => {},
      DEFAULT_LOCALE,
      fixturePort(spec),
    );
    await data.load();
    expect(data.resampledBars('A', '20240131', 'monthly', 2)).toEqual([]);
  });
});
