import type { FactorReport, FactorResearchIntentV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import {
  assertReleaseMaturity,
  assertReleaseMetadata,
  deriveFactorReleaseMetadata,
  FactorReleaseError,
} from './releases.js';

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

describe('factor release metadata derivation', () => {
  it('derives price and fundamental dependencies from a frozen valuation factor', () => {
    expect(
      deriveFactorReleaseMetadata(
        'single',
        `export default defineFactor({ compute(bar) { return bar.pb / bar.roe; } });`,
        'cross_sectional',
      ),
    ).toEqual({
      inputDomains: ['fundamental', 'price'],
      targetAssetClasses: ['equity'],
      outputScope: 'asset',
    });
  });

  it('unions dependencies from immutable composite component code', () => {
    const snapshot = JSON.stringify({
      kind: 'composite',
      components: [
        { code: `ctx.history(20)` },
        { code: `bar.netMain` },
        { code: `ctx.history(504, 'grossprofitMargin')` },
      ],
    });
    expect(
      deriveFactorReleaseMetadata('composite', snapshot, 'cross_sectional').inputDomains,
    ).toEqual(['flow', 'fundamental', 'price']);
  });

  it('fails closed for unknown legacy dependencies and unevaluated research types', () => {
    expect(() => deriveFactorReleaseMetadata('single', 'return 1', 'cross_sectional')).toThrowError(
      new FactorReleaseError('input_dependencies_unknown'),
    );
    expect(() => deriveFactorReleaseMetadata('single', 'bar.pb', 'time_series')).toThrowError(
      new FactorReleaseError('input_dependencies_unknown'),
    );
  });

  it('treats compatibility metadata as assertions, independent of array order', () => {
    const derived = {
      inputDomains: ['fundamental', 'price'] as const,
      targetAssetClasses: ['equity'] as const,
      outputScope: 'asset' as const,
    };
    expect(() =>
      assertReleaseMetadata(
        {
          inputDomains: ['price', 'fundamental'],
          targetAssetClasses: ['equity'],
          outputScope: 'asset',
        },
        {
          inputDomains: [...derived.inputDomains],
          targetAssetClasses: [...derived.targetAssetClasses],
          outputScope: derived.outputScope,
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertReleaseMetadata(
        { inputDomains: ['price'], targetAssetClasses: ['equity'], outputScope: 'asset' },
        {
          inputDomains: [...derived.inputDomains],
          targetAssetClasses: [...derived.targetAssetClasses],
          outputScope: derived.outputScope,
        },
      ),
    ).toThrowError(new FactorReleaseError('metadata_mismatch'));
  });
});
