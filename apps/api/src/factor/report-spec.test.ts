import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createDefaultFactorAnalysisSpecV2,
  factorTestKey,
  factorVariantKey,
  normalizeFactorAnalysisSpec,
  sha256,
} from './report-spec.js';

describe('factor report spec', () => {
  it('normalizes defaults and preserves the versioned shape', () => {
    expect(
      normalizeFactorAnalysisSpec({
        version: 1,
        freq: 'month',
        start: '20200101',
        end: '20251231',
      }),
    ).toEqual({
      version: 1,
      freq: 'month',
      start: '20200101',
      end: '20251231',
      neutral: 'none',
    });
  });

  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 0 })).toBe(
      '{"a":0,"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it('creates and validates a complete V2 methodology snapshot', () => {
    const spec = createDefaultFactorAnalysisSpecV2({
      freq: 'week',
      start: '20200101',
      end: '20251231',
      neutral: 'size',
    });

    expect(normalizeFactorAnalysisSpec(spec)).toEqual(spec);
    expect(spec.universe).toEqual({
      minimumListingDays: 365,
      liquidityDropFraction: 0.25,
      minimumCandidates: 100,
    });
    expect(spec.missing.minimumWindowCoverage).toBeCloseTo(2 / 3);
    expect(spec.outliers.factorExposure.method).toBe('winsor');
    expect(spec.costs.slippagePerSide).toBe(0.001);
  });

  it('includes every V2 methodology choice in variant identity', () => {
    const spec = createDefaultFactorAnalysisSpecV2({
      freq: 'month',
      start: '20200101',
      end: '20251231',
      neutral: 'none',
    });
    const codeHash = sha256('code-a');

    expect(
      factorVariantKey(
        {
          ...spec,
          missing: { minimumWindowCoverage: 0.8 },
        },
        codeHash,
      ),
    ).not.toBe(factorVariantKey(spec, codeHash));
  });

  it('changes variants when the spec or source changes', () => {
    const spec = normalizeFactorAnalysisSpec({
      version: 1,
      freq: 'month',
      start: '20200101',
      end: '20251231',
      neutral: 'none',
    });
    const codeHash = sha256('code-a');
    const variant = factorVariantKey(spec, codeHash);

    expect(factorVariantKey({ ...spec }, codeHash)).toBe(variant);
    expect(factorVariantKey({ ...spec, neutral: 'size' }, codeHash)).not.toBe(variant);
    expect(factorVariantKey(spec, sha256('code-b'))).not.toBe(variant);
  });

  it('keeps test identity independent from data revisions', () => {
    const spec = normalizeFactorAnalysisSpec({
      version: 1,
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'none',
    });
    const codeHash = sha256('code-a');
    const intent = {
      version: 1 as const,
      mode: 'hypothesis' as const,
      hypothesis: 'Value predicts returns',
      expectedDirection: 'positive' as const,
      primaryCriterion: { metric: 'rank_ic_mean' as const, operator: 'gt' as const, value: 0.02 },
    };

    expect(factorVariantKey(spec, codeHash, 'revision-a')).not.toBe(
      factorVariantKey(spec, codeHash, 'revision-b'),
    );
    expect(factorTestKey(spec, codeHash, intent)).toBe(
      factorTestKey(spec, codeHash, { ...intent, hypothesis: 'Reworded' }),
    );
    expect(factorTestKey(spec, codeHash, intent)).not.toBe(
      factorTestKey(spec, codeHash, {
        ...intent,
        primaryCriterion: { ...intent.primaryCriterion, value: 0.03 },
      }),
    );
  });
});
