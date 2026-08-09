import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createDefaultFactorAnalysisSpecV2,
  createDefaultFactorAnalysisSpecV3,
  createDefaultFactorAnalysisSpecV4,
  createDefaultFactorAnalysisSpecV5,
  factorTestKey,
  factorPanelCompositeDefinitionV2Schema,
  factorVariantKey,
  normalizeFactorAnalysisSpec,
  normalizeFactorResearchSpec,
  crossSectionalProtocol,
  sha256,
} from './report-spec.js';

describe('factor report spec', () => {
  it('defaults new reports to PIT historical-risk exclusions in V3', () => {
    const spec = createDefaultFactorAnalysisSpecV3({
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'none',
    });

    expect(spec.version).toBe(3);
    expect(spec.universe.excludeRiskWarnings).toBe(true);
    expect(spec.universe.excludePendingDelisting).toBe(true);
  });

  it('adapts every legacy analysis spec to the unified cross-sectional envelope', () => {
    const legacy = createDefaultFactorAnalysisSpecV5({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'none',
    });
    const research = normalizeFactorResearchSpec(legacy);

    expect(research).toEqual({
      version: 1,
      analysisKind: 'cross_sectional',
      protocol: legacy,
    });
    expect(crossSectionalProtocol(research)).toEqual(legacy);
  });

  it('validates time-series research with PIT data and Newey-West inference', () => {
    const research = normalizeFactorResearchSpec({
      version: 1,
      analysisKind: 'time_series',
      start: '20200101',
      end: '20250101',
      observationFrequency: 'daily',
      assets: ['511260.SH'],
      target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
      dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20250101' },
      inference: { standardError: 'newey_west', lag: 'automatic' },
    });

    expect(research.analysisKind).toBe('time_series');
    expect(() => crossSectionalProtocol(research)).toThrow(/time_series/);
  });

  it('validates commodity panel and macro-regime protocols without routing them to equities', () => {
    const common = {
      version: 1,
      start: '20200101',
      end: '20250101',
      observationFrequency: 'daily',
      target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
      dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20250101' },
    } as const;
    const panel = normalizeFactorResearchSpec({
      ...common,
      analysisKind: 'panel',
      assets: [
        { assetId: '510300.SH', assetClass: 'cn_equity' },
        { assetId: '511010.SH', assetClass: 'fixed_income' },
        { assetId: '518880.SH', assetClass: 'gold' },
      ],
      rankingScope: 'cross_asset',
      volatilityScaling: 'inverse_volatility',
      minimumAssetsPerPeriod: 3,
      portfolio: {
        topFraction: 1 / 3,
        bottomFraction: 1 / 3,
        transactionCostPerSide: 0.001,
      },
    });
    const macro = normalizeFactorResearchSpec({
      ...common,
      analysisKind: 'macro_regime',
      targetAssets: ['511260.SH', '518880.SH'],
      stateModel: { kind: 'quantile', states: 3 },
    });

    expect(panel.analysisKind).toBe('panel');
    expect(macro.analysisKind).toBe('macro_regime');
    expect(() => crossSectionalProtocol(panel)).toThrow(/panel/);
    expect(() => crossSectionalProtocol(macro)).toThrow(/macro_regime/);
  });

  it('validates and freezes a V4 equal-weight composite definition', () => {
    const spec = createDefaultFactorAnalysisSpecV4({
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'size_industry',
      composite: {
        version: 1,
        name: 'Quality + value',
        standardization: 'rank',
        weighting: 'equal',
        components: [
          { factor: 'roe_ttm', direction: 'positive' },
          { factor: 'ep_ttm', direction: 'positive' },
        ],
      },
    });

    expect(normalizeFactorAnalysisSpec(spec)).toEqual(spec);
    expect(spec.version).toBe(4);
  });

  it('validates a distinct V2 cross-asset panel composite definition', () => {
    expect(
      factorPanelCompositeDefinitionV2Schema.parse({
        version: 2,
        name: 'Momentum and low volatility',
        analysisKind: 'panel',
        standardization: 'rank',
        weighting: 'equal',
        components: [
          { factor: 'cross_asset_momentum_120', direction: 'positive' },
          { factor: 'cross_asset_volatility_60', direction: 'negative' },
        ],
      }),
    ).toMatchObject({ version: 2, analysisKind: 'panel' });
  });

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

  it('freezes within-industry ranking as a distinct V5 research identity', () => {
    const global = createDefaultFactorAnalysisSpecV5({
      freq: 'month',
      start: '20200101',
      end: '20250101',
      neutral: 'none',
    });
    const withinIndustry = createDefaultFactorAnalysisSpecV5({
      ...global,
      evaluationScope: { ...global.evaluationScope, rankingScope: 'within_industry' },
    });

    expect(normalizeFactorAnalysisSpec(withinIndustry)).toEqual(withinIndustry);
    expect(factorVariantKey(global, 'hash')).not.toEqual(factorVariantKey(withinIndustry, 'hash'));
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
        diagnostics: ['industry', 'size_bucket', 'liquidity_bucket'],
      },
    });

    expect(normalizeFactorAnalysisSpec(diagnostic)).toEqual(diagnostic);
    expect(factorVariantKey(base, 'hash')).not.toEqual(factorVariantKey(diagnostic, 'hash'));
  });

  it('rejects duplicate factors in a V4 composite', () => {
    const spec = createDefaultFactorAnalysisSpecV4({
      freq: 'month',
      start: '20200101',
      end: '20241231',
      neutral: 'none',
      composite: {
        version: 1,
        name: 'Duplicate',
        standardization: 'zscore',
        weighting: 'equal',
        components: [
          { factor: 'roe_ttm', direction: 'positive' },
          { factor: 'roe_ttm', direction: 'negative' },
        ],
      },
    });

    expect(() => normalizeFactorAnalysisSpec(spec)).toThrow(/distinct/);
  });

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
