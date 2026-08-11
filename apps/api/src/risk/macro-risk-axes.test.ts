import { MACRO_RISK_AXIS_KEYS_V1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MacroObservationVintageRow } from '../macro/as-of.js';
import {
  MACRO_RISK_AXIS_DEFINITIONS_V1,
  buildMacroRiskAxisHistory,
  type MacroRiskMarketObservation,
} from './macro-risk-axes.js';

describe('macro-risk axes', () => {
  it('builds five monthly score-change axes without replacing missing inputs with zero', () => {
    const fixture = input(96);
    const history = buildMacroRiskAxisHistory(fixture.macroRows, fixture.marketRows, {
      decisionDates: fixture.decisionDates,
      revisionPolicy: 'as_available',
    });

    expect(MACRO_RISK_AXIS_DEFINITIONS_V1.map((definition) => definition.key)).toEqual(
      MACRO_RISK_AXIS_KEYS_V1,
    );
    expect(history.lineage.pointInTimeEligible).toBe(true);
    const latestState = history.states.at(-1)!;
    const latestObservation = history.observations.at(-1)!;
    for (const axis of MACRO_RISK_AXIS_KEYS_V1) {
      expect(latestState.values[axis]).toEqual(expect.any(Number));
      expect(latestObservation.values[axis]).toEqual(expect.any(Number));
    }

    const withoutFx = buildMacroRiskAxisHistory(
      fixture.macroRows,
      fixture.marketRows.filter((row) => row.seriesKey !== 'USDCNH.FXCM'),
      {
        decisionDates: fixture.decisionDates,
        revisionPolicy: 'as_available',
      },
    );
    expect(withoutFx.states.at(-1)?.values.external).toBeUndefined();
    expect(withoutFx.observations.at(-1)?.values.external).toBeUndefined();
  });

  it('keeps latest-vintage exploration visibly ineligible for point-in-time use', () => {
    const fixture = input(96);
    fixture.macroRows[0]!.vintageDate = '20990101';

    const history = buildMacroRiskAxisHistory(fixture.macroRows, fixture.marketRows, {
      decisionDates: fixture.decisionDates,
      revisionPolicy: 'latest_vintage',
    });

    expect(history.lineage.pointInTimeEligible).toBe(false);
    expect(history.lineage.futureVintageRows).toBeGreaterThan(0);
    expect(history.revisionPolicy).toBe('latest_vintage');
  });

  it('rejects market values that were not available strictly after their source date', () => {
    const fixture = input(96);
    fixture.marketRows[0]!.availableDate = fixture.marketRows[0]!.sourceDate;

    expect(() =>
      buildMacroRiskAxisHistory(fixture.macroRows, fixture.marketRows, {
        decisionDates: fixture.decisionDates,
        revisionPolicy: 'as_available',
      }),
    ).toThrow('Invalid macro-risk market observation');
  });
});

function input(length: number): {
  decisionDates: string[];
  macroRows: MacroObservationVintageRow[];
  marketRows: MacroRiskMarketObservation[];
} {
  const months = Array.from({ length }, (_, index) => addMonths('201601', index));
  const decisionDates = months.map((month) => `${month}28`);
  const macroRows = months.flatMap((month, index) =>
    [
      ['cn_pmi_manufacturing', 49 + 0.03 * index + 1.2 * Math.sin(index * 0.23)],
      ['cn_cpi_yoy', 1.5 + 0.4 * Math.sin(index * 0.17)],
      ['cn_ppi_yoy', -0.5 + 0.06 * index + 1.7 * Math.cos(index * 0.13)],
      ['cn_m1_yoy', 4 + 0.04 * index + 0.8 * Math.sin(index * 0.29)],
      ['cn_m2_yoy', 7 + 0.02 * index + 0.5 * Math.cos(index * 0.19)],
      ['cn_shibor_3m', 2.8 - 0.004 * index + 0.2 * Math.sin(index * 0.31)],
      ['cn_social_financing_increment', 1_500 + 12 * index + 180 * Math.sin(index * 0.41)],
      ['cn_social_financing_stock', 120 + 1.7 * index + 2 * Math.cos(index * 0.11)],
    ].map(
      ([seriesKey, value]): MacroObservationVintageRow => ({
        seriesKey: seriesKey as string,
        period: seriesKey === 'cn_shibor_3m' ? `${month}20` : month,
        value: value as number,
        releaseDate: `${month}15`,
        availableDate: `${month}15`,
        availabilityKind: 'official_schedule',
        vintageDate: `${month}15`,
        vintageKind: 'captured_as_available',
      }),
    ),
  );
  const marketRows = months.flatMap((month, index): MacroRiskMarketObservation[] => [
    marketRow('us_treasury_nominal', month, 3 + 0.01 * index + 0.2 * Math.sin(index * 0.2)),
    marketRow('us_treasury_real', month, 1 + 0.008 * index + 0.1 * Math.cos(index * 0.27)),
    marketRow('USDCNH.FXCM', month, 6.4 + 0.004 * index + 0.1 * Math.sin(index * 0.16)),
  ]);
  return { decisionDates, macroRows, marketRows };
}

function marketRow(
  seriesKey: MacroRiskMarketObservation['seriesKey'],
  month: string,
  value: number,
): MacroRiskMarketObservation {
  return { seriesKey, sourceDate: `${month}20`, availableDate: `${month}21`, value };
}

function addMonths(month: string, months: number): string {
  const date = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1 + months),
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
