import type { PanelFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { PanelEvaluator, type PanelEvaluationObservation } from './panel-evaluator.js';

const spec: PanelFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'panel',
  start: '20240101',
  end: '20241231',
  observationFrequency: 'monthly',
  assets: [
    { assetId: 'CN', assetClass: 'cn_equity' },
    { assetId: 'US', assetClass: 'overseas_equity' },
    { assetId: 'BOND', assetClass: 'fixed_income' },
    { assetId: 'GOLD', assetClass: 'gold' },
  ],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: {
    pointInTime: true,
    revisionPolicy: 'as_available',
    dataCutoff: '20241231',
  },
  rankingScope: 'cross_asset',
  volatilityScaling: 'none',
  minimumAssetsPerPeriod: 4,
  portfolio: { topFraction: 0.25, bottomFraction: 0.25, transactionCostPerSide: 0.001 },
};

function period(
  asOfDate: string,
  targetDate: string,
  returns: [number, number, number, number],
): PanelEvaluationObservation[] {
  return spec.assets.map((asset, index) => ({
    ...asset,
    asOfDate,
    featureAvailableDate: asOfDate,
    targetDate,
    score: 4 - index,
    forwardReturn: returns[index],
    volatility: 0.1 + index * 0.01,
  }));
}

describe('PanelEvaluator', () => {
  it('evaluates cross-asset ranks against explicit equal-weight and fee baselines', () => {
    const report = new PanelEvaluator().evaluate(spec, [
      ...period('20240131', '20240229', [0.04, 0.02, 0.01, -0.01]),
      ...period('20240229', '20240329', [0.03, 0.02, 0, -0.02]),
      ...period('20240329', '20240430', [0.02, 0.01, 0, -0.01]),
    ]);

    expect(report.periods).toBe(3);
    expect(report.observations).toBe(12);
    expect(report.rankIcMean).toBe(1);
    expect(report.rankIcPositiveRate).toBe(1);
    expect(report.periodReports[0]).toMatchObject({
      eligibleAssets: 4,
      topReturn: 0.04,
      bottomReturn: -0.01,
      longShortGrossReturn: 0.05,
      oneWayTurnover: 0.5,
    });
    expect(report.periodReports[0].longShortNetReturn).toBeCloseTo(0.049);
    expect(report.equalWeightAnnualized).toBeGreaterThan(0);
    expect(report.longShortNetAnnualized).toBeLessThan(report.longShortGrossAnnualized);
    expect(report.normalizationDiagnostics).toMatchObject({
      withinClassRankIcMean: null,
      withinClassComparisons: 0,
      betweenClassRankIcMean: 1,
      betweenClassPeriods: 3,
    });
    expect(report.normalizationDiagnostics?.betweenClassLongShortNetAnnualized).toBeCloseTo(
      report.longShortNetAnnualized,
    );
    expect(report.coverage.byAsset).toEqual([
      expect.objectContaining({ assetId: 'CN', observations: 3 }),
      expect.objectContaining({ assetId: 'US', observations: 3 }),
      expect.objectContaining({ assetId: 'BOND', observations: 3 }),
      expect.objectContaining({ assetId: 'GOLD', observations: 3 }),
    ]);
  });

  it('separates within-class evidence and between-class portfolio diagnostics', () => {
    const imbalancedSpec: PanelFactorResearchSpecV1 = {
      ...spec,
      assets: [
        { assetId: 'C1', assetClass: 'commodity' },
        { assetId: 'C2', assetClass: 'commodity' },
        { assetId: 'C3', assetClass: 'commodity' },
        { assetId: 'B1', assetClass: 'fixed_income' },
        { assetId: 'B2', assetClass: 'fixed_income' },
        { assetId: 'CN', assetClass: 'cn_equity' },
        { assetId: 'US', assetClass: 'overseas_equity' },
        { assetId: 'GOLD', assetClass: 'gold' },
      ],
      minimumAssetsPerPeriod: 8,
      portfolio: { ...spec.portfolio, topFraction: 0.5, bottomFraction: 0.5 },
    };
    const makeRows = (asOfDate: string, targetDate: string) =>
      imbalancedSpec.assets.map((asset, index) => ({
        ...asset,
        asOfDate,
        featureAvailableDate: asOfDate,
        targetDate,
        score: 8 - index,
        forwardReturn: [0.08, 0.08, -0.08, 0, 0, 0, 0, 0][index],
        volatility: 0.1,
      }));
    const report = new PanelEvaluator().evaluate(imbalancedSpec, [
      ...makeRows('20240131', '20240229'),
      ...makeRows('20240229', '20240329'),
      ...makeRows('20240329', '20240430'),
    ]);

    expect(report.normalizationDiagnostics).toMatchObject({
      withinClassComparisons: 6,
      betweenClassPeriods: 3,
    });
    expect(report.normalizationDiagnostics?.withinClassRankIcMean).not.toBeNull();
    expect(report.normalizationDiagnostics?.betweenClassRankIcMean).not.toBeNull();
    expect(report.normalizationDiagnostics?.betweenClassLongShortNetAnnualized).not.toBeCloseTo(
      report.longShortNetAnnualized,
    );
  });

  it('reports missing-history periods instead of silently shrinking the universe', () => {
    const incomplete = period('20240131', '20240229', [0.04, 0.02, 0.01, -0.01]).slice(0, 3);
    const report = new PanelEvaluator().evaluate(spec, [
      ...incomplete,
      ...period('20240229', '20240329', [0.03, 0.02, 0, -0.02]),
      ...period('20240329', '20240430', [0.02, 0.01, 0, -0.01]),
      ...period('20240430', '20240531', [0.03, 0.01, -0.01, -0.02]),
    ]);

    expect(report.skippedPeriods).toBe(1);
    expect(report.periods).toBe(3);
    expect(report.coverage.minimumAssets).toBe(3);
    expect(report.coverage.byAsset.find((asset) => asset.assetId === 'GOLD')?.observations).toBe(3);
  });

  it('rejects look-ahead, inconsistent targets, and undeclared classifications', () => {
    const observations = [
      ...period('20240131', '20240229', [0.04, 0.02, 0.01, -0.01]),
      ...period('20240229', '20240329', [0.03, 0.02, 0, -0.02]),
      ...period('20240329', '20240430', [0.02, 0.01, 0, -0.01]),
    ];
    expect(() =>
      new PanelEvaluator().evaluate(spec, [
        { ...observations[0], featureAvailableDate: '20240201' },
        ...observations.slice(1),
      ]),
    ).toThrow(/look-ahead bias/);
    expect(() =>
      new PanelEvaluator().evaluate(spec, [
        { ...observations[0], targetDate: '20240228' },
        ...observations.slice(1),
      ]),
    ).toThrow(/common target date/);
    expect(() =>
      new PanelEvaluator().evaluate(spec, [
        { ...observations[0], assetClass: 'gold' },
        ...observations.slice(1),
      ]),
    ).toThrow(/undeclared asset or class/);
  });
});
