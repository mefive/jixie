import { describe, expect, it } from 'vitest';
import {
  createDefaultFactorAnalysisSpecV2,
  createDefaultFactorAnalysisSpecV5,
  createDefaultFactorAnalysisSpecV6,
  normalizeFactorAnalysisSpec,
} from '../analysis/spec.js';
import { sha256 } from '../sources/fingerprint.js';
import { factorVariantKey } from './identity.js';
describe('factor evaluation identity', () => {
  it('freezes a point-in-time index universe as a distinct V5 research identity', () => {
    const spec = createDefaultFactorAnalysisSpecV5({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'size',
      evaluationScope: {
        version: 1,
        universe: { kind: 'index', indexCode: '000300.SH' },
        membership: 'point_in_time',
        rankingScope: 'global',
        diagnostics: [],
      },
    });

    expect(normalizeFactorAnalysisSpec(spec)).toEqual(spec);
    expect(factorVariantKey(spec, 'hash')).not.toEqual(
      factorVariantKey(
        createDefaultFactorAnalysisSpecV5({
          ...spec,
          evaluationScope: {
            ...spec.evaluationScope,
            universe: { kind: 'market', market: 'cn_a' },
          },
        }),
        'hash',
      ),
    );
  });

  it('rejects retired within-industry ranking instead of silently using global ranking', () => {
    const global = createDefaultFactorAnalysisSpecV5({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'none',
    });
    expect(() =>
      normalizeFactorAnalysisSpec({
        ...global,
        evaluationScope: { ...global.evaluationScope, rankingScope: 'within_industry' },
      }),
    ).toThrow();
  });

  it('freezes diagnostic slices without changing the formal evaluation scope', () => {
    const base = createDefaultFactorAnalysisSpecV5({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'none',
    });
    const diagnostic = createDefaultFactorAnalysisSpecV5({
      ...base,
      evaluationScope: {
        ...base.evaluationScope,
        diagnostics: ['size_bucket', 'liquidity_bucket'],
      },
    });

    expect(normalizeFactorAnalysisSpec(diagnostic)).toEqual(diagnostic);
    expect(factorVariantKey(base, 'hash')).not.toEqual(factorVariantKey(diagnostic, 'hash'));
  });

  it('freezes robust inference in V6 identity', () => {
    const base = createDefaultFactorAnalysisSpecV6({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'none',
    });
    expect(normalizeFactorAnalysisSpec(base)).toEqual(base);
    expect(base.inference.famaMacbeth).toMatchObject({
      controlSet: 'cn_equity_style_v1',
      minimumPeriods: 12,
      minimumObservationsPerPeriod: 100,
      momentumLookbackTradingDays: 252,
      momentumSkipTradingDays: 21,
    });
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
});
