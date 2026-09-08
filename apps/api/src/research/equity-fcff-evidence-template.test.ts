import { EQUITY_FCFF_CLASSIFICATION_METHODS_SOURCE } from './equity-fcff-classification-template.js';
import { equityFcffClassificationSource } from './equity-fcff-classification-evidence.js';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { researchRuntimeManager } from './execution/python-session.js';
import {
  EQUITY_FCFF_DURATION_SOURCE,
  EQUITY_FCFF_TERMINAL_SOURCE,
  EQUITY_FCFF_ROLL_FORWARD_SOURCE,
  EQUITY_FCFF_MARKET_REVIEW_SOURCE,
} from './equity-fcff-evidence-template.js';

const DOCUMENT_ID = 'fcff-evidence-golden';
let previousLocal: string | undefined;
let previousExecutable: string | undefined;

describe('FCFF research evidence', { timeout: 60_000 }, () => {
  beforeEach(() => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    previousExecutable = process.env.JIXIE_PYTHON_EXECUTABLE;
    process.env.JIXIE_PYTHON_LOCAL = '1';
    process.env.JIXIE_PYTHON_EXECUTABLE = resolve(
      process.cwd(),
      '../../.venv/research-py-v1/bin/python3',
    );
  });
  afterEach(() => {
    researchRuntimeManager.close(DOCUMENT_ID);
    if (previousLocal === undefined) {
      delete process.env.JIXIE_PYTHON_LOCAL;
    } else {
      process.env.JIXIE_PYTHON_LOCAL = previousLocal;
    }
    if (previousExecutable === undefined) {
      delete process.env.JIXIE_PYTHON_EXECUTABLE;
    } else {
      process.env.JIXIE_PYTHON_EXECUTABLE = previousExecutable;
    }
  });

  it('separates growth duration, terminal reinvestment, and the unchanged-path roll', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'financial-evidence',
      source: `
valuation_base = {"nopat_margin": 0.2}
valuation_base_inputs = pd.DataFrame([{"revenue": 100.0, "nopat_margin": 0.2}])
valuation_bridge_inputs = pd.DataFrame([{"bridge_adjustment": 0.0, "issued_shares": 10.0, "operating_cash_required": 1.0}])
base_scenario = {"scenario": "base", "revenue_growth": 0.0, "target_nopat_margin": 0.2, "incremental_capital_turnover": 1.0, "wacc": 0.1, "terminal_growth": 0.0, "terminal_roic": 0.2}
forecast_years = 5
${EQUITY_FCFF_DURATION_SOURCE}
assert np.allclose(growth_duration_comparison["per_share_value_cny"], 20.0)
base_scenario["terminal_growth"] = 0.02
${EQUITY_FCFF_TERMINAL_SOURCE}
terminal_index = terminal_stress_comparison.set_index("terminal_case")
assert abs(terminal_index.loc["return_equals_cost", "reinvestment_rate"] - 0.2) < 1e-12
assert terminal_index.loc["persistent_excess_return", "per_share_value_cny"] > terminal_index.loc["return_equals_cost", "per_share_value_cny"]
base_scenario["terminal_growth"] = 0.0
scenario_forecasts = valuation.fcff_scenarios(valuation_base_inputs, pd.DataFrame([base_scenario]), valuation_bridge_inputs, forecast_years=5)
valuation_base_period = pd.Timestamp("20231231")
review_base_period = pd.Timestamp("20241231")
review_base = {"nopat_margin": 0.2}
review_base_inputs = valuation_base_inputs.copy()
review_bridge_inputs = valuation_bridge_inputs.copy()
${EQUITY_FCFF_ROLL_FORWARD_SOURCE}
assert abs(frozen_remaining_enterprise_value - 200.0) < 1e-10
assert abs(frozen_roll_return - 0.1) < 1e-12
pd.DataFrame([{"passed": True}])`,
    });
    expect(result.outputs[0]).toMatchObject({ type: 'table', rows: [{ passed: true }] });
  });

  it('does not relabel a short or gapped market history as a completed validation window', async () => {
    const functionsOnly = EQUITY_FCFF_MARKET_REVIEW_SOURCE.split(
      '\nmarket_observations = aligned_market_observations(',
    )[0];
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'market-evidence',
      source: `
${functionsOnly}
dates = pd.to_datetime(["2025-01-02", "2025-02-03", "2025-04-02", "2025-07-02"])
stock = pd.DataFrame({"date": dates, "value": [100.0, 80.0, 110.0, 120.0]})
benchmark = pd.DataFrame({"date": dates, "value": [100.0, 90.0, 105.0, 110.0]})
aligned = aligned_market_observations(stock, benchmark, "20250102", "20250702")
three_month = market_window_summary(aligned, "20250102", "20250702", 3)
assert abs(three_month["stock_adjusted_return"] - 0.1) < 1e-12
assert abs(three_month["return_difference"] - 0.05) < 1e-12
assert abs(three_month["stock_max_drawdown"] + 0.2) < 1e-12
assert market_window_summary(aligned, "20250102", "20250702", 12)["status"] == "not_yet_observed"
for bad in [benchmark.iloc[1:], benchmark.drop(index=1), pd.concat([benchmark, benchmark.iloc[:1]])]:
    try:
        aligned_market_observations(stock, bad, "20250102", "20250702")
        raise AssertionError("missing date or duplicate accepted")
    except ValueError:
        pass
pd.DataFrame([{"passed": True}])`,
    });
    expect(result.outputs[0]).toMatchObject({ type: 'table', rows: [{ passed: true }] });
  });
  it('reconciles annual classification without doubling maturing products or current leases', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'classification-evidence',
      source: `
valuation_identifier = "000333.SZ"
${equityFcffClassificationSource('000333.SZ')}
${EQUITY_FCFF_CLASSIFICATION_METHODS_SOURCE}
note = selected_classification_note("20251231", "20260401")
amounts = classification_amounts(note, "current")
assert amounts["current_assets"] == 156789662000.0
assert amounts["extra_assets"] == 215503011000.0
assert amounts["lease"] == 1901053000.0
assert amounts["income"] == 9080416000.0

def metric_value(frame, period, metric):
    values = {"effectiveTaxRate": 0.25, "revenue": 400e9, "nopat": 40e9,
              "workingCapital": 100e9, "investedCapital": 300e9}
    return values[metric]

def metric_optional_value(frame, period, metric):
    return -30e9, "ok"

result = annual_classification(None, "20251231", "20260401")
assert abs(result["removed_current_asset_change_cny"] - 81030403000.0) < 0.01
assert abs(result["partial_fcff_cny"] - 44220091000.0) < 0.01
assert result["status"] == "partial_classification_not_audited"
for period, date in [("20251231", "20250331"), ("20261231", "20270901")]:
    try:
        selected_classification_note(period, date)
        raise AssertionError("unavailable annual evidence accepted")
    except ValueError:
        pass
bad = dict(note)
bad["items"] = note["items"] + [note["items"][0]]
try:
    classification_amounts(bad, "current")
    raise AssertionError("duplicate asset accepted")
except ValueError:
    pass
pd.DataFrame([{"passed": True}])`,
    });
    expect(result.outputs[0]).toMatchObject({ type: 'table', rows: [{ passed: true }] });
  });
});
