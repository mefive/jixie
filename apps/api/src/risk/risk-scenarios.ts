import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type MarketRiskFactorKeyV1,
  type PortfolioMarketRiskAnalysisV1,
  type PortfolioRiskScenarioResultV1,
  type PortfolioRiskScenarioShockV1,
} from '@jixie/shared';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';

export const HISTORICAL_RISK_SCENARIO_MINIMUM_FACTOR_COVERAGE = 0.8;

const BASIS_POINT_FACTORS = new Set<MarketRiskFactorKeyV1>([
  'cgb_level',
  'cgb_slope',
  'cgb_curvature',
  'credit_spread',
  'us_real_yield',
]);

export interface DeterministicRiskScenarioPresetV1 {
  key: string;
  kind: 'deterministic';
  shocks: PortfolioRiskScenarioShockV1[];
}

export interface HistoricalRiskScenarioWindowV1 {
  key: string;
  kind: 'historical';
  startDate: string;
  endDate: string;
}

export const DETERMINISTIC_RISK_SCENARIO_PRESETS_V1: readonly DeterministicRiskScenarioPresetV1[] =
  [
    deterministic('cn_equity_drawdown_10pct', [returnShock('cn_equity', -0.1)]),
    deterministic('cgb_yield_up_50bp', [basisPointShock('cgb_level', 50)]),
    deterministic('cgb_yield_down_50bp', [basisPointShock('cgb_level', -50)]),
    deterministic('credit_spread_widening_50bp', [basisPointShock('credit_spread', 50)]),
    deterministic('rmb_depreciation_5pct', [returnShock('usd_cnh', 0.05)]),
    deterministic('us_real_yield_up_50bp', [basisPointShock('us_real_yield', 50)]),
    deterministic('commodity_drawdown_10pct', [returnShock('commodity', -0.1)]),
    deterministic('cross_asset_risk_off', [
      returnShock('cn_equity', -0.1),
      basisPointShock('cgb_level', -30),
      basisPointShock('credit_spread', 50),
      returnShock('usd_cnh', 0.05),
      basisPointShock('us_real_yield', -20),
      returnShock('gold', 0.05),
      returnShock('commodity', -0.08),
    ]),
  ];

export const HISTORICAL_RISK_SCENARIO_WINDOWS_V1: readonly HistoricalRiskScenarioWindowV1[] = [
  {
    key: 'china_risk_off_2018',
    kind: 'historical',
    startDate: '20180601',
    endDate: '20181031',
  },
  {
    key: 'covid_q1_2020',
    kind: 'historical',
    startDate: '20200102',
    endDate: '20200331',
  },
  {
    key: 'global_inflation_2022',
    kind: 'historical',
    startDate: '20220104',
    endDate: '20221031',
  },
];

/** Applies frozen deterministic shocks to the current multivariate exposure vector. */
export function evaluateDeterministicRiskScenarios(
  marketRisk: PortfolioMarketRiskAnalysisV1,
  presets: readonly DeterministicRiskScenarioPresetV1[] = DETERMINISTIC_RISK_SCENARIO_PRESETS_V1,
): PortfolioRiskScenarioResultV1[] {
  if (!marketRisk.lineage.pointInTimeEligible || marketRisk.lineage.futureVintageRows !== 0) {
    return [];
  }
  validateUniqueScenarioKeys(presets);
  return presets.map((preset) => ({
    key: preset.key,
    kind: 'deterministic',
    asOfDate: marketRisk.asOfDate,
    shocks: validateShocks(preset.shocks),
    estimatedReturnImpact: scenarioImpact(marketRisk, preset.shocks),
    methodology: 'linear_factor_shock',
  }));
}

/** Replays cumulative historical driver moves against current exposures without replaying prices. */
export function evaluateHistoricalRiskScenarios(
  marketRisk: PortfolioMarketRiskAnalysisV1,
  driverHistory: MarketRiskDriverHistoryV1,
  windows: readonly HistoricalRiskScenarioWindowV1[] = HISTORICAL_RISK_SCENARIO_WINDOWS_V1,
): PortfolioRiskScenarioResultV1[] {
  if (
    !marketRisk.lineage.pointInTimeEligible ||
    marketRisk.lineage.futureVintageRows !== 0 ||
    !driverHistory.lineage.pointInTimeEligible ||
    driverHistory.lineage.futureVintageRows !== 0
  ) {
    return [];
  }
  validateUniqueScenarioKeys(windows);
  return windows.flatMap((window) => {
    validateHistoricalWindow(window);
    const aggregates = MARKET_RISK_FACTOR_KEYS_V1.map((factor) => ({
      factor,
      aggregate: aggregateHistoricalShock(driverHistory, factor, window),
    }));
    const maximumObservations = Math.max(
      ...aggregates.map((row) => row.aggregate?.observations ?? 0),
    );
    if (
      maximumObservations === 0 ||
      aggregates.some(
        (row) =>
          !row.aggregate ||
          row.aggregate.observations / maximumObservations <
            HISTORICAL_RISK_SCENARIO_MINIMUM_FACTOR_COVERAGE,
      )
    ) {
      return [];
    }
    const shocks = aggregates.map(({ factor, aggregate }) => ({
      factor,
      shock: aggregate!.shock,
      unit: BASIS_POINT_FACTORS.has(factor)
        ? ('basis_point_change' as const)
        : ('decimal_return' as const),
    }));
    return [
      {
        key: window.key,
        kind: 'historical',
        asOfDate: marketRisk.asOfDate,
        historicalWindow: { startDate: window.startDate, endDate: window.endDate },
        shocks,
        estimatedReturnImpact: scenarioImpact(marketRisk, shocks),
        methodology: 'linear_factor_shock',
      } satisfies PortfolioRiskScenarioResultV1,
    ];
  });
}

function scenarioImpact(
  marketRisk: PortfolioMarketRiskAnalysisV1,
  shocks: PortfolioRiskScenarioShockV1[],
): number {
  const exposureByFactor = new Map(
    marketRisk.exposures.map((exposure) => [exposure.factor, exposure]),
  );
  return validateShocks(shocks).reduce((sum, shock) => {
    const exposure = exposureByFactor.get(shock.factor);
    if (!exposure) {
      throw new Error(`Risk scenario lacks a portfolio exposure for ${shock.factor}.`);
    }
    const expectedUnit = BASIS_POINT_FACTORS.has(shock.factor)
      ? 'return_per_basis_point'
      : 'return_per_return';
    if (exposure.coefficientUnit !== expectedUnit) {
      throw new Error(`Risk scenario exposure unit mismatch for ${shock.factor}.`);
    }
    return sum + exposure.coefficient * shock.shock;
  }, 0);
}

function aggregateHistoricalShock(
  history: MarketRiskDriverHistoryV1,
  factor: MarketRiskFactorKeyV1,
  window: HistoricalRiskScenarioWindowV1,
): { shock: number; observations: number } | null {
  const values = history.observations
    .filter(
      (observation) => observation.date >= window.startDate && observation.date <= window.endDate,
    )
    .flatMap((observation) => {
      const value = observation.values[factor];
      return value == null || !Number.isFinite(value) ? [] : [value];
    });
  if (values.length === 0) {
    return null;
  }
  return {
    shock: BASIS_POINT_FACTORS.has(factor)
      ? values.reduce((sum, value) => sum + value, 0)
      : values.reduce((wealth, value) => wealth * (1 + value), 1) - 1,
    observations: values.length,
  };
}

function validateShocks(
  shocks: readonly PortfolioRiskScenarioShockV1[],
): PortfolioRiskScenarioShockV1[] {
  const factors = new Set<MarketRiskFactorKeyV1>();
  return shocks.map((shock) => {
    const expectedUnit = BASIS_POINT_FACTORS.has(shock.factor)
      ? 'basis_point_change'
      : 'decimal_return';
    if (
      !MARKET_RISK_FACTOR_KEYS_V1.includes(shock.factor) ||
      !Number.isFinite(shock.shock) ||
      shock.unit !== expectedUnit ||
      factors.has(shock.factor)
    ) {
      throw new Error(`Invalid or duplicate risk scenario shock ${shock.factor}.`);
    }
    factors.add(shock.factor);
    return { ...shock };
  });
}

function validateUniqueScenarioKeys(presets: ReadonlyArray<{ key: string }>): void {
  if (
    presets.some((preset) => !preset.key.trim()) ||
    new Set(presets.map((preset) => preset.key)).size !== presets.length
  ) {
    throw new Error('Risk scenario keys must be non-empty and unique.');
  }
}

function validateHistoricalWindow(window: HistoricalRiskScenarioWindowV1): void {
  if (
    !/^\d{8}$/.test(window.startDate) ||
    !/^\d{8}$/.test(window.endDate) ||
    window.startDate > window.endDate
  ) {
    throw new Error(`Invalid historical risk scenario window ${window.key}.`);
  }
}

function deterministic(
  key: string,
  shocks: PortfolioRiskScenarioShockV1[],
): DeterministicRiskScenarioPresetV1 {
  return { key, kind: 'deterministic', shocks };
}

function returnShock(factor: MarketRiskFactorKeyV1, shock: number): PortfolioRiskScenarioShockV1 {
  return { factor, shock, unit: 'decimal_return' };
}

function basisPointShock(
  factor: MarketRiskFactorKeyV1,
  shock: number,
): PortfolioRiskScenarioShockV1 {
  return { factor, shock, unit: 'basis_point_change' };
}
