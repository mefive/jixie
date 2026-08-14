import { describe, expect, it } from 'vitest';
import { researchCapabilityCatalog } from './catalog.js';

describe('research capability catalog', () => {
  it('publishes a complete bilingual contract for every protocol', () => {
    for (const protocol of researchCapabilityCatalog.protocols) {
      expect(protocol.questionKinds).toContain(protocol.id);
      expect(protocol.assumptions.length).toBeGreaterThan(0);
      expect(protocol.parameters.some((parameter) => parameter.adjustable)).toBe(true);
      expect(protocol.terminology.length).toBeGreaterThan(0);
      expect(protocol.formulae.length).toBeGreaterThan(0);
      expect(protocol.pythonExample).toContain('import ');
      expect(protocol.helpSlugs.zh.length).toBeGreaterThan(0);
      expect(protocol.helpSlugs.en.length).toBeGreaterThan(0);
      expect(protocol.formulae.map((formula) => formula.id)).toEqual(
        expectedFormulaIds[protocol.id],
      );
      expect(new Set(protocol.formulae.map((formula) => formula.id)).size).toBe(
        protocol.formulae.length,
      );
      expect(new Set(protocol.formulae.map((formula) => formula.group))).toEqual(
        new Set(['core_estimate', 'inference', 'robustness']),
      );

      for (const item of [
        ...protocol.assumptions,
        ...protocol.parameters,
        ...protocol.terminology,
      ]) {
        expect(item.labelZh).not.toBe('');
        expect(item.labelEn).not.toBe('');
        expect(item.descriptionZh).not.toBe('');
        expect(item.descriptionEn).not.toBe('');
      }

      for (const formula of protocol.formulae) {
        expect(formula.labelZh).not.toBe('');
        expect(formula.labelEn).not.toBe('');
        expect(formula.latex).not.toBe('');
        expect(formula.variables.length).toBeGreaterThan(0);
        for (const variable of formula.variables) {
          expect(variable.symbol).not.toBe('');
          expect(variable.descriptionZh).not.toBe('');
          expect(variable.descriptionEn).not.toBe('');
        }
      }
    }
  });
});

const expectedFormulaIds = {
  time_series_relationship: [
    'pearson_correlation',
    'linear_regression',
    'newey_west_covariance',
    'slope_inference',
    'spearman_correlation',
    'rolling_relationship',
  ],
  distribution_comparison: [
    'welch_mean_difference',
    'welch_inference',
    'mann_whitney_inference',
    'cohens_d',
    'cliffs_delta',
    'winsorized_mean_difference',
  ],
  event_study: [
    'market_adjusted_return',
    'cumulative_abnormal_return',
    'event_date_clustered_standard_error',
    'event_mean_inference',
    'positive_car_fraction',
    'winsorized_mean_car',
  ],
} as const;
