import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  researchDownstreamDependencyCellIds,
  RESEARCH_FCFF_SCENARIO_COLUMNS_V1,
  RESEARCH_IMPLIED_REVENUE_GROWTH_COLUMNS_V1,
} from '@jixie/shared';
import {
  EQUITY_FCFF_MODEL_SOURCE,
  EQUITY_FCFF_PARAMETER_SOURCE,
  EQUITY_FCFF_SELECTION_SOURCE,
  EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE,
  equityFcffValuationTemplate,
} from './equity-fcff-valuation-template.js';
import { researchRuntimeManager } from './execution/python-session.js';

const DOCUMENT_ID = 'equity-fcff-valuation-template-test';
let previousLocal: string | undefined;
let previousExecutable: string | undefined;

describe('equity FCFF valuation Research template', { timeout: 30_000 }, () => {
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

  it('keeps the full valuation workflow visible in editable Markdown and Python Cells', () => {
    const template = equityFcffValuationTemplate();
    const source = template.cells.map((cell) => cell.source).join('\n');

    expect(template.title).toContain('FCFF');
    expect(template.cells).toHaveLength(29);
    expect(template.cells.filter((cell) => cell.kind === 'python')).toHaveLength(24);
    expect(source).toContain('data.equity_financial_metrics');
    expect(source).toContain('data.equity_financial_statements');
    expect(source).toContain('data.yield_curve');
    expect(source).toContain('valuation.fcff_scenarios');
    expect(source).toContain('valuation.implied_revenue_growth');
    expect(source).not.toContain('def value_fcff_scenario');
    expect(source).not.toContain('def solve_single_parameter');
    expect(source).toContain('unsupported_financial_company');
    expect(source).toContain('narrative_review');
    expect(source).toContain('不代表平台目标价或买卖建议');
  });

  it('makes parameter changes propagate through the valuation outputs', async () => {
    const pythonCells = equityFcffValuationTemplate()
      .cells.filter((cell) => cell.kind === 'python')
      .map((cell, index) => ({ id: `python-${index}`, source: cell.source }));
    const analysis = await researchRuntimeManager.analyze(DOCUMENT_ID, pythonCells);
    const dependencyCells = analysis.map((cell) => ({
      id: cell.cellId,
      definitions: cell.definitions,
      references: cell.references,
    }));
    const downstream = researchDownstreamDependencyCellIds(dependencyCells, ['python-0']);

    expect(analysis[0]?.definitions).toContain('valuation_date');
    expect(analysis[1]?.references).toContain('valuation_date');
    expect(downstream).toContain('python-1');
    expect(downstream).toContain('python-6');
    expect(downstream).toContain('python-9');
    expect(downstream).toContain('python-11');
  });

  it('matches hand calculations, monotonic checks, and reverse-solver diagnostics', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'golden',
      source: `base = pd.DataFrame([{"revenue": 100.0, "nopat_margin": 0.20}])
bridge = pd.DataFrame([{
    "bridge_adjustment": 0.0,
    "issued_shares": 10.0,
    "operating_cash_required": 1.0,
}])
zero_growth = pd.DataFrame([{
    "scenario": "zero_growth",
    "revenue_growth": 0.0,
    "target_nopat_margin": 0.20,
    "incremental_capital_turnover": 1.0,
    "wacc": 0.10,
    "terminal_growth": 0.0,
    "terminal_roic": 0.20,
}])
zero_summary = valuation.fcff_scenarios(
    base, zero_growth, bridge, forecast_years=1
).iloc[0]

high_wacc = zero_growth.copy()
high_wacc.loc[0, "wacc"] = 0.12
high_wacc_summary = valuation.fcff_scenarios(
    base, high_wacc, bridge, forecast_years=1
).iloc[0]

high_fcff = zero_growth.copy()
high_fcff.loc[0, "target_nopat_margin"] = 0.25
high_fcff_summary = valuation.fcff_scenarios(
    base, high_fcff, bridge, forecast_years=1
).iloc[0]

known_growth = 0.06
known_scenario = zero_growth.copy()
known_scenario.loc[0, "revenue_growth"] = known_growth
known_summary = valuation.fcff_scenarios(
    base, known_scenario, bridge, forecast_years=5
).iloc[0]
recovered = valuation.implied_revenue_growth(
    base,
    known_scenario,
    bridge,
    target_enterprise_value=known_summary["enterprise_value"],
    forecast_years=5,
).iloc[0]

no_solution = valuation.implied_revenue_growth(
    base,
    zero_growth,
    bridge,
    target_enterprise_value=1.0,
    forecast_years=1,
).iloc[0]
weakly_identified = valuation.implied_revenue_growth(
    base,
    zero_growth,
    bridge,
    target_enterprise_value=zero_summary["enterprise_value"],
    forecast_years=1,
    minimum_value_span_fraction=100.0,
).iloc[0]

invalid_growth = zero_growth.copy()
invalid_growth.loc[0, "terminal_growth"] = invalid_growth.loc[0, "wacc"]
try:
    valuation.fcff_scenarios(base, invalid_growth, bridge, forecast_years=1)
    invalid_diagnostic = "not_rejected"
except ValueError as error:
    invalid_diagnostic = str(error)

pd.DataFrame([{
    "forward_columns_match": sorted(zero_summary.index) == sorted(${JSON.stringify(RESEARCH_FCFF_SCENARIO_COLUMNS_V1.map((column) => column.name))}),
    "reverse_columns_match": sorted(recovered.index) == sorted(${JSON.stringify(RESEARCH_IMPLIED_REVENUE_GROWTH_COLUMNS_V1.map((column) => column.name))}),
    "hand_value_ok": abs(zero_summary["per_share_value_cny"] - 20.0) < 1e-10,
    "wacc_monotonic": high_wacc_summary["enterprise_value"] < zero_summary["enterprise_value"],
    "fcff_monotonic": high_fcff_summary["enterprise_value"] > zero_summary["enterprise_value"],
    "reverse_recovered": abs(recovered["implied_value"] - known_growth) < 1e-6,
    "no_solution": no_solution["status"],
    "weak_identification": weakly_identified["status"],
    "invalid_diagnostic": invalid_diagnostic,
}])`,
    });

    const output = result.outputs[0];
    expect(output?.type).toBe('table');
    if (output?.type !== 'table') {
      throw new Error('Expected a table output');
    }
    expect(output.rows).toEqual([
      {
        index: 0,
        forward_columns_match: true,
        reverse_columns_match: true,
        hand_value_ok: true,
        wacc_monotonic: true,
        fcff_monotonic: true,
        reverse_recovered: true,
        no_solution: 'no_solution',
        weak_identification: 'weakly_identified',
        invalid_diagnostic: 'terminal_growth_must_be_less_than_wacc',
      },
    ]);
  });

  it('detects nearby reverse roots, tangent roots, and invalid public inputs', async () => {
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'solver-boundaries',
      source: `base = pd.DataFrame([{"revenue": 100.0, "nopat_margin": 0.8}])
bridge = pd.DataFrame([{"bridge_adjustment": 5.0, "issued_shares": 10.0, "operating_cash_required": 1.0}])
scenario = pd.DataFrame([{
    "scenario": "quadratic", "revenue_growth": -0.5001, "target_nopat_margin": 0.2,
    "incremental_capital_turnover": 0.4, "wacc": 0.1, "terminal_growth": 0.0, "terminal_roic": 0.2,
}])
original = scenario.copy(deep=True)
target = valuation.fcff_scenarios(base, scenario, bridge, forecast_years=2).iloc[0]
multiple = valuation.implied_revenue_growth(base, scenario, bridge,
    target_enterprise_value=target["enterprise_value"], forecast_years=2,
    lower=-0.8, upper=-0.2, minimum_value_span_fraction=0.0).iloc[0]
scenario.loc[0, "revenue_growth"] = -0.5
tangent_target = valuation.fcff_scenarios(base, scenario, bridge, forecast_years=2).iloc[0]
tangent = valuation.implied_revenue_growth(base, scenario, bridge,
    target_enterprise_value=tangent_target["enterprise_value"], forecast_years=2,
    lower=-0.8, upper=-0.2, minimum_value_span_fraction=0.0).iloc[0]
errors = []
for invalid_kind in ["missing_bridge", "negative_cash", "duplicate_columns", "nan_scenario", "too_many_years"]:
    candidate_bridge = bridge.copy()
    candidate_scenario = scenario.copy()
    years = 2
    if invalid_kind == "missing_bridge":
        candidate_bridge = candidate_bridge.drop(columns=["issued_shares"])
    elif invalid_kind == "negative_cash":
        candidate_bridge.loc[0, "operating_cash_required"] = -1.0
    elif invalid_kind == "duplicate_columns":
        candidate_bridge = pd.concat([candidate_bridge, candidate_bridge[["issued_shares"]]], axis=1)
    elif invalid_kind == "nan_scenario":
        candidate_scenario.loc[0, "scenario"] = np.nan
    else:
        years = 21
    try:
        valuation.fcff_scenarios(base, candidate_scenario, candidate_bridge, forecast_years=years)
    except ValueError:
        errors.append(invalid_kind)
scenario.loc[0, "revenue_growth"] = -0.5001
non_finite = valuation.implied_revenue_growth(base, scenario, bridge,
    target_enterprise_value=target["enterprise_value"], forecast_years=2,
    upper=1e200).iloc[0]
flat_base = base.assign(nopat_margin=0.0)
flat_scenario = scenario.assign(revenue_growth=0.0, target_nopat_margin=0.0)
zero_value = valuation.fcff_scenarios(flat_base, flat_scenario, bridge).iloc[0]
pd.DataFrame([{
    "multiple": multiple["status"], "tangent": tangent["status"],
    "non_finite": non_finite["status"], "zero_ev_share_missing": pd.isna(zero_value["terminal_value_share"]),
    "tangent_value": tangent["implied_value"], "rejected_count": len(errors),
    "inputs_unchanged": scenario.equals(original),
    "bridge_ok": abs(target["equity_value"] - (target["enterprise_value"] - 5.0)) < 1e-10,
    "formula_version": target["formula_version"],
}])`,
    });
    const output = result.outputs[0];
    if (output?.type !== 'table') {
      throw new Error('Expected a table output');
    }
    expect(output.rows[0]).toMatchObject({
      non_finite: 'non_finite_scan',
      zero_ev_share_missing: true,
      multiple: 'multiple_solutions',
      tangent: 'solved',
      rejected_count: 5,
      inputs_unchanged: true,
      bridge_ok: true,
      formula_version: 'fcff-scenarios-v1',
    });
    expect(Number(output.rows[0]?.tangent_value)).toBeCloseTo(-0.5, 7);
  });

  it('independently recalculates every WACC and terminal-growth sensitivity value', async () => {
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'parameters',
      source: EQUITY_FCFF_PARAMETER_SOURCE,
    });
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'fixture',
      source: `valuation_base = {"revenue": 100.0, "nopat_margin": 0.20}
valuation_bridge = {
    "bridge_adjustment": 5.0,
    "issued_shares": 10.0,
    "operating_cash_required": 1.0,
}
forecast_years = 5
terminal_value_warning_threshold = 0.75
valuation_scenarios = pd.DataFrame([{
    "scenario": "base",
    "revenue_growth": 0.04,
    "target_nopat_margin": 0.24,
    "incremental_capital_turnover": 1.5,
    "wacc": 0.08,
    "terminal_growth": 0.02,
    "terminal_roic": 0.16,
}])`,
    });
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'model',
      source: EQUITY_FCFF_MODEL_SOURCE,
    });
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'sensitivity',
      source: EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE,
    });
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'independent-check',
      source: `independent_differences = []
for sensitivity_row in sensitivity_table.to_dict("records"):
    independent_wacc = sensitivity_row["wacc_pct"] / 100
    independent_growth = sensitivity_row["terminal_growth_pct"] / 100
    independent_previous_revenue = valuation_base["revenue"]
    independent_present_value = 0.0
    for independent_year in range(1, forecast_years + 1):
        independent_revenue = independent_previous_revenue * (1 + base_scenario["revenue_growth"])
        independent_margin = valuation_base["nopat_margin"] + (
            base_scenario["target_nopat_margin"] - valuation_base["nopat_margin"]
        ) * independent_year / forecast_years
        independent_nopat = independent_revenue * independent_margin
        independent_reinvestment = (
            independent_revenue - independent_previous_revenue
        ) / base_scenario["incremental_capital_turnover"]
        independent_fcff = independent_nopat - independent_reinvestment
        independent_present_value += independent_fcff / ((1 + independent_wacc) ** independent_year)
        independent_previous_revenue = independent_revenue
    independent_terminal_revenue = independent_previous_revenue * (1 + independent_growth)
    independent_terminal_nopat = independent_terminal_revenue * base_scenario["target_nopat_margin"]
    independent_terminal_fcff = independent_terminal_nopat * (
        1 - independent_growth / base_scenario["terminal_roic"]
    )
    independent_terminal_value = independent_terminal_fcff / (
        independent_wacc - independent_growth
    )
    independent_enterprise_value = independent_present_value + (
        independent_terminal_value / ((1 + independent_wacc) ** forecast_years)
    )
    independent_per_share = (
        independent_enterprise_value - valuation_bridge["bridge_adjustment"]
    ) / valuation_bridge["issued_shares"]
    independent_differences.append(
        abs(independent_per_share - sensitivity_row["per_share_value_cny"])
    )
pd.DataFrame([{
    "cell_count": len(independent_differences),
    "maximum_absolute_difference": max(independent_differences),
    "all_match": max(independent_differences) < 1e-10,
}])`,
    });

    const output = result.outputs[0];
    expect(output?.type).toBe('table');
    if (output?.type !== 'table') {
      throw new Error('Expected a table output');
    }
    expect(output.rows[0]).toMatchObject({
      cell_count: 25,
      all_match: true,
    });
    expect(Number(output.rows[0]?.maximum_absolute_difference)).toBeLessThan(1e-10);
  });

  it('stops with explicit diagnostics for financial companies and missing bridges', async () => {
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'selection',
      source: EQUITY_FCFF_SELECTION_SOURCE,
    });
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'invalid-inputs',
      source: `financial_company_metrics = pd.DataFrame([{
    "report_period": pd.NaT,
    "metric": "revenue",
    "value": np.nan,
    "status": "not_applicable",
    "missing_reason": "unsupported_financial_company",
}])
try:
    latest_complete_period(financial_company_metrics, ["revenue"], annual_only=True)
    financial_company_diagnostic = "not_rejected"
except ValueError as error:
    financial_company_diagnostic = str(error)

missing_bridge_metrics = pd.DataFrame([
    {
        "report_period": pd.Timestamp("2024-12-31"),
        "metric": "marketCapitalization",
        "value": 100.0,
        "status": "ok",
        "missing_reason": None,
    },
    {
        "report_period": pd.Timestamp("2024-12-31"),
        "metric": "enterpriseValue",
        "value": np.nan,
        "status": "missing",
        "missing_reason": "daily_basic_unavailable",
    },
    {
        "report_period": pd.Timestamp("2024-12-31"),
        "metric": "issuedShares",
        "value": 10.0,
        "status": "ok",
        "missing_reason": None,
    },
])
try:
    latest_complete_period(
        missing_bridge_metrics,
        ["marketCapitalization", "enterpriseValue", "issuedShares"],
    )
    missing_bridge_diagnostic = "not_rejected"
except ValueError as error:
    missing_bridge_diagnostic = str(error)

pd.DataFrame([{
    "financial_company": financial_company_diagnostic,
    "missing_bridge": missing_bridge_diagnostic,
}])`,
    });

    const output = result.outputs[0];
    expect(output?.type).toBe('table');
    if (output?.type !== 'table') {
      throw new Error('Expected a table output');
    }
    expect(output.rows[0]).toEqual({
      index: 0,
      financial_company: 'unsupported_financial_company',
      missing_bridge:
        'metric_unavailable:enterpriseValue:2024-12-31 00:00:00:daily_basic_unavailable',
    });
  });

  it('does not silently fall back to an older annual report when the latest one is quarantined', async () => {
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'selection',
      source: EQUITY_FCFF_SELECTION_SOURCE,
    });
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'quarantined-latest',
      source: `candidate_metrics = pd.DataFrame([
    {"report_period": pd.Timestamp("2023-12-31"), "metric": "revenue", "value": 100.0, "status": "ok", "missing_reason": None},
    {"report_period": pd.Timestamp("2024-12-31"), "metric": "revenue", "value": np.nan, "status": "invalid", "missing_reason": "accounting_review_required:test"},
])
try:
    latest_complete_period(candidate_metrics, ["revenue"], annual_only=True)
    rejection = "not_rejected"
except ValueError as error:
    rejection = str(error)
pd.DataFrame([{"rejection": rejection}])`,
    });
    const output = result.outputs[0];
    expect(output?.type).toBe('table');
    if (output?.type !== 'table') {
      throw new Error('Expected table');
    }
    expect(output.rows[0]?.rejection).toContain('accounting_review_required:test');
  });
});
