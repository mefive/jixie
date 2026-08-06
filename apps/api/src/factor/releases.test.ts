import type { FactorReport, FactorResearchIntentV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { assertReleaseMaturity, FactorReleaseError } from './releases.js';

const reportPayload = {
  icMean: 0.04,
  icirAnnual: 1.2,
  longShortNet: { annReturn: 0.08 },
} as FactorReport;
const intent: FactorResearchIntentV1 = {
  version: 1,
  mode: 'hypothesis',
  hypothesis: 'A signal predicts forward returns',
  expectedDirection: 'positive',
  primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0.03 },
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    status: 'done',
    phase: 'holdout',
    revealedAt: new Date('2026-08-05T00:00:00Z'),
    payload: JSON.stringify(reportPayload),
    researchIntentJson: JSON.stringify(intent),
    ...overrides,
  };
}

describe('factor release maturity gates', () => {
  it('allows completed exploration reports only as experimental releases', () => {
    expect(() =>
      assertReleaseMaturity(report({ phase: 'explore', revealedAt: null }), 'experimental'),
    ).not.toThrow();
    expect(() =>
      assertReleaseMaturity(report({ phase: 'explore', revealedAt: null }), 'validated'),
    ).toThrowError(new FactorReleaseError('validation_required'));
  });

  it('allows a validated release only after a revealed holdout passes its criterion', () => {
    expect(() => assertReleaseMaturity(report(), 'validated')).not.toThrow();
    expect(() =>
      assertReleaseMaturity(
        report({
          researchIntentJson: JSON.stringify({
            ...intent,
            primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0.05 },
          }),
        }),
        'validated',
      ),
    ).toThrowError(new FactorReleaseError('validation_required'));
  });

  it('keeps production closed until operational gates exist', () => {
    expect(() => assertReleaseMaturity(report(), 'production')).toThrowError(
      new FactorReleaseError('production_not_ready'),
    );
  });
});
