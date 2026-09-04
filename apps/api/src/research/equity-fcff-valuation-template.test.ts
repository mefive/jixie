import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { researchDownstreamDependencyCellIds } from '@jixie/shared';
import {
  EQUITY_FCFF_MODEL_SOURCE,
  EQUITY_FCFF_PARAMETER_SOURCE,
  EQUITY_FCFF_SELECTION_SOURCE,
  EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE,
  equityFcffValuationTemplate,
} from './equity-fcff-valuation-template.js';
import { researchRuntimeManager } from './workbench-runtime.js';

const DOCUMENT_ID = 'equity-fcff-valuation-template-test';
let previousLocal: string | undefined;
let previousExecutable: string | undefined;

describe('equity FCFF valuation Research template', () => {
  beforeEach(() => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    previousExecutable = process.env.JIXIE_PYTHON_EXECUTABLE;
    process.env.JIXIE_PYTHON_LOCAL = '1';
    process.env.JIXIE_PYTHON_EXECUTABLE = resolve(process.cwd(), '../../.venv/bin/python');
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
    expect(template.cells).toHaveLength(16);
    expect(template.cells.filter((cell) => cell.kind === 'python')).toHaveLength(12);
    expect(source).toContain('data.equity_financial_metrics');
    expect(source).toContain('data.equity_financial_statements');
    expect(source).toContain('data.yield_curve');
    expect(source).toContain('value_fcff_scenario');
    expect(source).toContain('solve_single_parameter');
    expect(source).toContain('terminal_growth_must_be_less_than_wacc');
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
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'parameters',
      source: EQUITY_FCFF_PARAMETER_SOURCE,
    });
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'model',
      source: EQUITY_FCFF_MODEL_SOURCE,
    });
    const result = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'golden',
      source: `base = {"revenue": 100.0, "nopat_margin": 0.20}
bridge = {
    "bridge_adjustment": 0.0,
    "issued_shares": 10.0,
    "operating_cash_required": 1.0,
}
zero_growth = {
    "scenario": "zero_growth",
    "revenue_growth": 0.0,
    "target_nopat_margin": 0.20,
    "incremental_capital_turnover": 1.0,
    "wacc": 0.10,
    "terminal_growth": 0.0,
    "terminal_roic": 0.20,
}
_, zero_summary = value_fcff_scenario(base, zero_growth, bridge, 1)

high_wacc = dict(zero_growth)
high_wacc["wacc"] = 0.12
_, high_wacc_summary = value_fcff_scenario(base, high_wacc, bridge, 1)

high_fcff = dict(zero_growth)
high_fcff["target_nopat_margin"] = 0.25
_, high_fcff_summary = value_fcff_scenario(base, high_fcff, bridge, 1)

known_growth = 0.06
known_scenario = dict(zero_growth)
known_scenario["revenue_growth"] = known_growth
_, known_summary = value_fcff_scenario(base, known_scenario, bridge, 5)
def known_value_function(growth):
    candidate = dict(known_scenario)
    candidate["revenue_growth"] = float(growth)
    return value_fcff_scenario(base, candidate, bridge, 5)[1]["enterprise_value"]
recovered = solve_single_parameter(
    known_summary["enterprise_value"], known_value_function, -0.20, 0.30
)

no_solution = solve_single_parameter(10.0, lambda value: value, 0.0, 1.0)
multiple_solutions = solve_single_parameter(
    0.0,
    lambda value: (value - 1.0) * (value + 1.0),
    -2.0,
    2.0,
    minimum_value_span_fraction=0.0,
)
weakly_identified = solve_single_parameter(
    1.0,
    lambda value: 1.0 + value * 1e-8,
    -1.0,
    1.0,
    minimum_value_span_fraction=0.05,
)

invalid_growth = dict(zero_growth)
invalid_growth["terminal_growth"] = invalid_growth["wacc"]
try:
    value_fcff_scenario(base, invalid_growth, bridge, 1)
    invalid_diagnostic = "not_rejected"
except ValueError as error:
    invalid_diagnostic = str(error)

pd.DataFrame([{
    "hand_value_ok": abs(zero_summary["per_share_value_cny"] - 20.0) < 1e-10,
    "wacc_monotonic": high_wacc_summary["enterprise_value"] < zero_summary["enterprise_value"],
    "fcff_monotonic": high_fcff_summary["enterprise_value"] > zero_summary["enterprise_value"],
    "reverse_recovered": abs(recovered["solution"] - known_growth) < 1e-6,
    "no_solution": no_solution["status"],
    "multiple_solutions": multiple_solutions["status"],
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
        hand_value_ok: true,
        wacc_monotonic: true,
        fcff_monotonic: true,
        reverse_recovered: true,
        no_solution: 'no_solution',
        multiple_solutions: 'multiple_solutions',
        weak_identification: 'weakly_identified',
        invalid_diagnostic: 'terminal_growth_must_be_less_than_wacc',
      },
    ]);
  });

  it('independently recalculates every WACC and terminal-growth sensitivity value', async () => {
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'parameters',
      source: EQUITY_FCFF_PARAMETER_SOURCE,
    });
    await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'model',
      source: EQUITY_FCFF_MODEL_SOURCE,
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
      missing_bridge: 'no_complete_any_period:marketCapitalization,enterpriseValue,issuedShares',
    });
  });
});
