import { describe, expect, it } from 'vitest';
import type { MacroAsOfSnapshot, MacroObservationVintageRow } from './as-of.js';
import { buildMacroRegimeScoreHistory, computeMacroRegimeScore } from './regime-score.js';

describe('macro regime continuous score', () => {
  it('keeps continuous axes and derives an interpretable quadrant', () => {
    const snapshot = syntheticSnapshot('latest_vintage');
    const score = computeMacroRegimeScore(snapshot);

    expect(score.state).toBe('growth_strong_inflation_low');
    expect(score.growth.score).toBeGreaterThan(0);
    expect(score.growth.pmiGap).toBeGreaterThan(0);
    expect(score.inflation.score).toBeLessThan(0);
    expect(score.growth.latestPeriods).toEqual(['202412']);
    expect(score.inflation.latestPeriods).toEqual(['202411', '202411']);
    expect(score.featureAvailableDate).toBe('20250120');
    expect(score.latestVintageDate).toBe('20250131');
    expect(score.disclosure).toEqual({
      latestValueBackfillRows: 107,
      futureVintageRows: 107,
      pointInTimeEligible: false,
    });
  });

  it('allows publication only for an as-available snapshot without future vintages', () => {
    const score = computeMacroRegimeScore({
      ...syntheticSnapshot('as_available'),
      disclosure: { latestValueBackfillRows: 107, futureVintageRows: 0 },
    });

    expect(score.disclosure.pointInTimeEligible).toBe(true);
  });

  it('requires enough history for each canonical series', () => {
    const snapshot = syntheticSnapshot('as_available');
    snapshot.observations = snapshot.observations.filter(
      (row) => row.seriesKey !== 'cn_ppi_yoy' || row.period >= '202401',
    );

    expect(() => computeMacroRegimeScore(snapshot)).toThrow(
      'at least 24 observations for cn_ppi_yoy',
    );
  });

  it('fails closed on duplicate series periods', () => {
    const snapshot = syntheticSnapshot('as_available');
    snapshot.observations.push({ ...snapshot.observations[0]! });

    expect(() => computeMacroRegimeScore(snapshot)).toThrow('duplicate period');
  });

  it('fails closed when a supposedly gated snapshot contains a future release', () => {
    const snapshot = syntheticSnapshot('latest_vintage');
    snapshot.observations[0] = { ...snapshot.observations[0]!, availableDate: '20250201' };

    expect(() => computeMacroRegimeScore(snapshot)).toThrow('unavailable on the decision date');
  });

  it('builds a historical series and records dates without enough PIT history', () => {
    const snapshot = syntheticSnapshot('latest_vintage');
    const history = buildMacroRegimeScoreHistory(snapshot.observations, {
      decisionDates: ['20220131', '20241231', '20201231'],
      revisionPolicy: 'latest_vintage',
    });

    expect(history.scores.map((score) => score.asOfDate)).toEqual(['20220131', '20241231']);
    expect(history.skippedDates).toEqual(['20201231']);
    expect(history.scores.every((score) => !score.disclosure.pointInTimeEligible)).toBe(true);
  });
});

function syntheticSnapshot(revisionPolicy: MacroAsOfSnapshot['revisionPolicy']): MacroAsOfSnapshot {
  const pmi = monthlyRows('cn_pmi_manufacturing', '202001', 60, (index) => 47 + index * 0.08);
  const cpi = monthlyRows('cn_cpi_yoy', '202001', 59, (index) => 4 - index * 0.055);
  const ppi = monthlyRows('cn_ppi_yoy', '202001', 59, (index) => 7 - index * 0.1);
  const observations = [...pmi, ...cpi, ...ppi];
  return {
    decisionDate: '20250131',
    revisionPolicy,
    observations,
    disclosure: {
      latestValueBackfillRows: 107,
      futureVintageRows: revisionPolicy === 'latest_vintage' ? 107 : 0,
    },
  };
}

function monthlyRows(
  seriesKey: string,
  firstPeriod: string,
  count: number,
  value: (index: number) => number,
): MacroObservationVintageRow[] {
  return Array.from({ length: count }, (_, index) => {
    const period = addMonths(firstPeriod, index);
    return {
      seriesKey,
      period,
      value: value(index),
      releaseDate: null,
      availableDate: `${addMonths(period, 1)}20`,
      availabilityKind: 'conservative_lag',
      vintageDate: '20250131',
      vintageKind: 'latest_value_backfill',
    };
  });
}

function addMonths(period: string, months: number): string {
  const date = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(4, 6)) - 1 + months),
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
