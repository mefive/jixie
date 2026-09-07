import { equityFcffClassificationSource } from './equity-fcff-classification-evidence.js';

export interface EquityFcffReplayScenario {
  scenario: 'downside' | 'base' | 'upside';
  revenueGrowth: number;
  targetNopatMargin: number;
  incrementalCapitalTurnover: number;
  wacc: number;
  terminalGrowth: number;
  terminalRoic: number;
}

export interface EquityFcffReplayCase {
  identifier: string;
  companyName: string;
  businessPattern: string;
  valuationDate: string;
  reviewDate: string;
  scenarios: readonly EquityFcffReplayScenario[];
}

export const EQUITY_FCFF_REPLAY_CASES = [
  {
    identifier: '000858.SZ',
    companyName: '五粮液',
    businessPattern: '高利润率、轻资产消费品',
    valuationDate: '20250428',
    reviewDate: '20260506',
    scenarios: [
      scenario('downside', 0, 0.33, 1.25, 0.085, 0.01, 0.14),
      scenario('base', 0.04, 0.36, 1.5, 0.075, 0.015, 0.18),
      scenario('upside', 0.08, 0.38, 1.75, 0.065, 0.02, 0.22),
    ],
  },
  {
    identifier: '000333.SZ',
    companyName: '美的集团',
    businessPattern: '制造业、营运资本驱动',
    valuationDate: '20250331',
    reviewDate: '20260401',
    scenarios: [
      scenario('downside', 0.03, 0.085, 0.8, 0.09, 0.01, 0.1),
      scenario('base', 0.07, 0.1, 1.2, 0.08, 0.02, 0.14),
      scenario('upside', 0.11, 0.115, 1.6, 0.07, 0.03, 0.18),
    ],
  },
  {
    identifier: '300750.SZ',
    companyName: '宁德时代',
    businessPattern: '资本密集型成长制造业',
    valuationDate: '20250317',
    reviewDate: '20260311',
    scenarios: [
      scenario('downside', 0.05, 0.13, 0.7, 0.1, 0.015, 0.12),
      scenario('base', 0.12, 0.17, 1, 0.085, 0.025, 0.18),
      scenario('upside', 0.2, 0.2, 1.3, 0.075, 0.035, 0.24),
    ],
  },
] as const satisfies readonly EquityFcffReplayCase[];

export function equityFcffParameterSource(replayCase: EquityFcffReplayCase): string {
  const rows = replayCase.scenarios
    .map(
      (item) => `    {
        "scenario": ${JSON.stringify(item.scenario)},
        "revenue_growth": ${item.revenueGrowth},
        "target_nopat_margin": ${item.targetNopatMargin},
        "incremental_capital_turnover": ${item.incrementalCapitalTurnover},
        "wacc": ${item.wacc},
        "terminal_growth": ${item.terminalGrowth},
        "terminal_roic": ${item.terminalRoic},
    }`,
    )
    .join(',\n');

  return `valuation_identifier = ${JSON.stringify(replayCase.identifier)}
valuation_date = ${JSON.stringify(replayCase.valuationDate)}
review_date = ${JSON.stringify(replayCase.reviewDate)}
forecast_years = 5
market_cutoff_date = "20260730"
benchmark_identifier = "510300.SH"

# These are explicit teaching assumptions, not platform forecasts or recommendations.
operating_cash_required_cny = 0.0
other_non_operating_assets_cny = 0.0
other_senior_claims_cny = 0.0
terminal_value_warning_threshold = 0.75
reverse_growth_lower = -0.20
reverse_growth_upper = 0.30
reverse_growth_tolerance = 1e-8
reverse_minimum_value_span_fraction = 0.05

valuation_scenarios = pd.DataFrame([
${rows},
])
${equityFcffClassificationSource(replayCase.identifier)}
valuation_scenarios`;
}

function scenario(
  name: EquityFcffReplayScenario['scenario'],
  revenueGrowth: number,
  targetNopatMargin: number,
  incrementalCapitalTurnover: number,
  wacc: number,
  terminalGrowth: number,
  terminalRoic: number,
): EquityFcffReplayScenario {
  return {
    scenario: name,
    revenueGrowth,
    targetNopatMargin,
    incrementalCapitalTurnover,
    wacc,
    terminalGrowth,
    terminalRoic,
  };
}
