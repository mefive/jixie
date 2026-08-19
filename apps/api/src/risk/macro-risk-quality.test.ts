import { MACRO_RISK_AXIS_KEYS_V1, type RiskDataLineageV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MacroRiskAxisHistoryV1 } from './macro-risk-axes.js';
import { selectMacroRiskAuditStart, summarizeMacroRiskAxisQuality } from './macro-risk-quality.js';

describe('macro-risk axis quality', () => {
  it('widens a short general audit window for monthly readiness', () => {
    expect(selectMacroRiskAuditStart('20250819', '20260819')).toBe('20220819');
    expect(selectMacroRiskAuditStart('20200101', '20260819')).toBe('20200101');
    expect(selectMacroRiskAuditStart('20100101', '20260819')).toBe('20180326');
  });

  it('warns rather than fabricating strict history when exploratory coverage is ready', () => {
    const exploratory = history(60, false, true);
    const strict = history(60, true, false);

    const summary = summarizeMacroRiskAxisQuality(exploratory, strict);

    expect(summary).toMatchObject({
      status: 'warn',
      exploratoryCompleteObservations: 60,
      strictCompleteObservations: 0,
    });
    expect(summary.warnings[0]).toContain('local vintages accumulate');
  });

  it('fails when one exploratory axis has too little usable history', () => {
    const exploratory = history(60, false, true);
    for (const observation of exploratory.observations.slice(0, 30)) {
      delete observation.values.credit;
    }

    const summary = summarizeMacroRiskAxisQuality(exploratory, history(60, true, false));

    expect(summary.status).toBe('error');
    expect(summary.errors.join(' ')).toContain('credit');
  });
});

function history(
  length: number,
  pointInTimeEligible: boolean,
  complete: boolean,
): MacroRiskAxisHistoryV1 {
  const dates = Array.from(
    { length },
    (_, index) => `202${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, '0')}28`,
  );
  const observations = dates.map((date) => ({
    date,
    values: complete ? Object.fromEntries(MACRO_RISK_AXIS_KEYS_V1.map((axis) => [axis, 0.1])) : {},
  }));
  const lineage: RiskDataLineageV1 = {
    dataCutoff: dates.at(-1)!,
    pointInTimeEligible,
    futureVintageRows: 0,
    series: [],
  };
  return {
    version: 1,
    definitions: [],
    revisionPolicy: pointInTimeEligible ? 'as_available' : 'latest_vintage',
    states: dates.map((date) => ({
      month: date.slice(0, 6),
      date,
      values: {},
      latestAvailableDates: {},
      seriesAvailableThrough: {},
      pointInTimeEligible,
      futureVintageRows: 0,
    })),
    observations,
    skippedDates: [],
    lineage,
  };
}
