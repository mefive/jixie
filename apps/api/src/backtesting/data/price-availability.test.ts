import { describe, expect, it } from 'vitest';
import { EngineData } from './engine-data.js';
import { fixturePort } from '../testing/fixture-port.js';

describe('exact-date execution data and carried valuations', () => {
  it('carries a suspended close without inventing an executable bar or future price', async () => {
    const data = new EngineData({
      start: '20240102',
      end: '20240104',
      dataPort: fixturePort({
        dates: ['20240102', '20240103', '20240104'],
        stocks: [
          {
            code: 'A',
            bars: [
              { date: '20240102', open: 10, close: 11, adj: 2 },
              { date: '20240104', open: 15, close: 16, adj: 3 },
            ],
          },
        ],
      }),
    });
    await data.load();
    await data.loadBars(['A']);
    expect(data.adjustedOpenOn('A', '20240102')).toBe(20);
    expect(data.adjustedCloseAsOf('A', '20240103')).toBe(22);
    expect(data.adjustmentFactorAsOf('A', '20240103')).toBe(2);
    expect(data.rawCloseAsOf('A', '20240103')).toBe(11);
    expect(data.adjustedOpenOn('A', '20240103')).toBeNull();
    expect(data.adjustedOhlcOn('A', '20240103')).toBeNull();
    expect(data.adjustmentFactorOn('A', '20240103')).toBeNull();
    expect(data.adjustedCloseAsOf('A', '20240101')).toBeNull();
    expect(data.adjustedOpenOn('A', '20240104')).toBe(45);
  });
});
