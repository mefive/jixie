import { describe, expect, it } from 'vitest';
import {
  assignCurveAvailableDates,
  parseChinaTreasuryCurveResponse,
} from './china-treasury-curve.js';

describe('China treasury yield curve source', () => {
  it('parses official term series and assigns the next SSE trading day as the PIT gate', () => {
    const response = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 30].map((termYears) => ({
      dcq: termYears,
      ycDefId: 'curve',
      ycDefName: `${termYears}Y`,
      // The official endpoint represents a China-calendar date as 00:00 in UTC+8.
      seriesData: [[Date.UTC(2026, 7, 5, 16), 1 + termYears / 100]],
    }));

    const points = parseChinaTreasuryCurveResponse(response, '20260806', '20260806');
    const available = assignCurveAvailableDates(points, ['20260806', '20260807']);

    expect(points).toHaveLength(9);
    expect(available.find((point) => point.termYears === 10)).toEqual({
      tradeDate: '20260806',
      availableDate: '20260807',
      termYears: 10,
      yieldPct: 1.1,
    });
  });

  it('rejects a partial curve date instead of silently changing the research universe', () => {
    expect(() =>
      parseChinaTreasuryCurveResponse(
        [{ dcq: 10, seriesData: [[Date.UTC(2026, 7, 6), 1.7]] }],
        '20260806',
        '20260806',
      ),
    ).toThrow(/1\/9 maturities/);
  });

  it('rejects same-day availability because the source publishes after market close', () => {
    expect(() =>
      assignCurveAvailableDates(
        [{ tradeDate: '20260806', termYears: 10, yieldPct: 1.7 }],
        ['20260806'],
      ),
    ).toThrow(/No next SSE trading day/);
  });
});
