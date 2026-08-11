import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type MarketRiskFactorKeyV1,
  type PortfolioMarketRiskAnalysisV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';
import {
  DETERMINISTIC_RISK_SCENARIO_PRESETS_V1,
  HISTORICAL_RISK_SCENARIO_WINDOWS_V1,
  evaluateDeterministicRiskScenarios,
  evaluateHistoricalRiskScenarios,
} from './risk-scenarios.js';

describe('portfolio risk scenarios', () => {
  it('applies deterministic return and basis-point shocks in exposure units', () => {
    const scenarios = evaluateDeterministicRiskScenarios(marketRisk(), [
      {
        key: 'unit_test',
        kind: 'deterministic',
        shocks: [
          { factor: 'cn_equity', shock: -0.1, unit: 'decimal_return' },
          { factor: 'cgb_level', shock: 50, unit: 'basis_point_change' },
        ],
      },
    ]);

    expect(scenarios[0]).toMatchObject({
      key: 'unit_test',
      kind: 'deterministic',
      estimatedReturnImpact: -0.1,
      methodology: 'linear_factor_shock',
    });
  });

  it('compounds historical return drivers and sums basis-point changes', () => {
    const scenarios = evaluateHistoricalRiskScenarios(marketRisk(), driverHistory(), [
      {
        key: 'history_test',
        kind: 'historical',
        startDate: '20240102',
        endDate: '20240103',
      },
    ]);
    const scenario = scenarios[0]!;

    expect(scenario.kind).toBe('historical');
    if (scenario.kind !== 'historical') {
      throw new Error('Expected historical scenario.');
    }
    expect(scenario.historicalWindow).toEqual({
      startDate: '20240102',
      endDate: '20240103',
    });
    expect(scenario.shocks.find((shock) => shock.factor === 'cn_equity')?.shock).toBeCloseTo(
      0.045,
      12,
    );
    expect(scenario.shocks.find((shock) => shock.factor === 'cgb_level')?.shock).toBe(7);
  });

  it('keeps preset identifiers unique and exposes both deterministic and historical catalogs', () => {
    expect(new Set(DETERMINISTIC_RISK_SCENARIO_PRESETS_V1.map((preset) => preset.key)).size).toBe(
      DETERMINISTIC_RISK_SCENARIO_PRESETS_V1.length,
    );
    expect(new Set(HISTORICAL_RISK_SCENARIO_WINDOWS_V1.map((preset) => preset.key)).size).toBe(
      HISTORICAL_RISK_SCENARIO_WINDOWS_V1.length,
    );
    expect(DETERMINISTIC_RISK_SCENARIO_PRESETS_V1.length).toBeGreaterThan(5);
    expect(HISTORICAL_RISK_SCENARIO_WINDOWS_V1.length).toBe(3);
  });

  it('rejects unit mismatches instead of silently rescaling a scenario', () => {
    expect(() =>
      evaluateDeterministicRiskScenarios(marketRisk(), [
        {
          key: 'bad_unit',
          kind: 'deterministic',
          shocks: [{ factor: 'cgb_level', shock: 0.5, unit: 'decimal_return' }],
        },
      ]),
    ).toThrow('Invalid or duplicate risk scenario shock');
  });

  it('omits a historical window when one factor falls below the coverage gate', () => {
    const history = driverHistory();
    delete history.observations[1]!.values.gold;

    expect(
      evaluateHistoricalRiskScenarios(marketRisk(), history, [
        {
          key: 'sparse_history',
          kind: 'historical',
          startDate: '20240102',
          endDate: '20240103',
        },
      ]),
    ).toEqual([]);
  });

  it('does not evaluate scenarios from non-PIT market evidence', () => {
    const report = marketRisk();
    report.lineage.pointInTimeEligible = false;

    expect(evaluateDeterministicRiskScenarios(report)).toEqual([]);
    expect(evaluateHistoricalRiskScenarios(report, driverHistory())).toEqual([]);
  });
});

function marketRisk(): PortfolioMarketRiskAnalysisV1 {
  return {
    version: 1,
    frequency: 'daily',
    methodology: 'rolling_multivariate_regression_ewma_covariance',
    asOfDate: '20241231',
    lookbackObservations: 252,
    minimumObservations: 120,
    observations: 252,
    covarianceHalfLife: 60,
    annualizedPortfolioVolatility: 0.15,
    explainedVariance: 0.6,
    exposures: MARKET_RISK_FACTOR_KEYS_V1.map((factor) => ({
      factor,
      coefficient: factor === 'cn_equity' ? 0.5 : factor === 'cgb_level' ? -0.001 : 0.01,
      coefficientUnit: basisPointFactor(factor)
        ? ('return_per_basis_point' as const)
        : ('return_per_return' as const),
      varianceContribution: 0,
      varianceContributionShare: null,
    })),
    lineage: lineage(),
  };
}

function driverHistory(): MarketRiskDriverHistoryV1 {
  const observations = [
    { date: '20240102', returnValue: 0.1, basisPointValue: 10 },
    { date: '20240103', returnValue: -0.05, basisPointValue: -3 },
  ].map((row) => ({
    date: row.date,
    values: Object.fromEntries(
      MARKET_RISK_FACTOR_KEYS_V1.map((factor) => [
        factor,
        basisPointFactor(factor) ? row.basisPointValue : row.returnValue,
      ]),
    ) as Record<MarketRiskFactorKeyV1, number>,
  }));
  return { version: 1, definitions: [], observations, lineage: lineage() };
}

function lineage(): RiskDataLineageV1 {
  return {
    dataCutoff: '20241231',
    pointInTimeEligible: true,
    futureVintageRows: 0,
    series: [],
  };
}

function basisPointFactor(factor: MarketRiskFactorKeyV1): boolean {
  return ['cgb_level', 'cgb_slope', 'cgb_curvature', 'credit_spread', 'us_real_yield'].includes(
    factor,
  );
}
