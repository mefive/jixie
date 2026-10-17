import { describe, expect, it } from 'vitest';
import { calculateWindowCoverage } from './series.js';

describe('factor series coverage', () => {
  it('measures a stock window against market open days', () => {
    const marketDates = ['20240102', '20240103', '20240104', '20240105', '20240108'];
    const stockDates = ['20240102', '20240104', '20240108'];

    expect(calculateWindowCoverage(stockDates, 2, marketDates, 4, 5)).toBe(3 / 5);
    expect(calculateWindowCoverage(stockDates, 2, marketDates, 4, 3)).toBe(2 / 3);
  });
});
