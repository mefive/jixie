import {
  EQUITY_FCFF_CLASSIFICATION_METHODS_SOURCE,
  EQUITY_FCFF_CLASSIFICATION_RECONCILIATION_SOURCE,
  EQUITY_FCFF_CLASSIFICATION_VALUATION_SOURCE,
  EQUITY_FCFF_CLASSIFICATION_SOURCES_SOURCE,
} from './classification-template.js';
import {
  EQUITY_FCFF_MARKET_DATA_SOURCE,
  EQUITY_FCFF_DURATION_SOURCE,
  EQUITY_FCFF_TERMINAL_SOURCE,
  EQUITY_FCFF_CASH_RECONCILIATION_SOURCE,
  EQUITY_FCFF_ROLL_FORWARD_SOURCE,
  EQUITY_FCFF_MARKET_REVIEW_SOURCE,
  EQUITY_FCFF_MARKET_CHART_SOURCE,
  EQUITY_FCFF_CUTOFF_SOURCE,
} from './evidence-template.js';
import { EQUITY_FCFF_REPLAY_CASES, equityFcffParameterSource } from './replay-cases.js';

export interface ResearchTemplateCellSeed {
  kind: 'markdown' | 'python';
  source: string;
}

export const EQUITY_FCFF_PARAMETER_SOURCE = equityFcffParameterSource(EQUITY_FCFF_REPLAY_CASES[0]);

export const EQUITY_FCFF_DATA_SOURCE = `valuation_metrics = data.equity_financial_metrics(
    valuation_identifier, as_of=valuation_date
)
valuation_statements = data.equity_financial_statements(
    valuation_identifier, as_of=valuation_date
)
review_metrics = data.equity_financial_metrics(
    valuation_identifier, as_of=review_date
)
review_statements = data.equity_financial_statements(
    valuation_identifier, as_of=review_date
)
valuation_cgb_10y = data.yield_curve(
    "mof_cgb_ytm", tenor="10Y", start=valuation_date, end=valuation_date
)
review_cgb_10y = data.yield_curve(
    "mof_cgb_ytm", tenor="10Y", start=review_date, end=review_date
)

data_version_summary = pd.concat([
    valuation_statements.assign(research_stage="initial"),
    review_statements.assign(research_stage="review"),
], ignore_index=True)[[
    "research_stage", "as_of_date", "report_period", "statement_kind",
    "announcement_date", "available_date", "availability_quality",
    "source_row_fingerprint",
]].drop_duplicates().sort_values([
    "research_stage", "report_period", "statement_kind"
]).reset_index(drop=True)
data_version_summary.tail(12)`;

export const EQUITY_FCFF_SELECTION_SOURCE = `def metric_record(frame, report_period, metric):
    period = pd.Timestamp(report_period)
    rows = frame[(frame["report_period"] == period) & (frame["metric"] == metric)]
    if len(rows) != 1:
        raise ValueError(
            f"expected_one_metric_row:{metric}:{period.date()}:found_{len(rows)}"
        )
    return rows.iloc[0]


def metric_value(frame, report_period, metric):
    row = metric_record(frame, report_period, metric)
    if row["status"] != "ok" or pd.isna(row["value"]):
        reason = row["missing_reason"] if pd.notna(row["missing_reason"]) else row["status"]
        raise ValueError(f"metric_unavailable:{metric}:{report_period}:{reason}")
    return float(row["value"])


def metric_optional_value(frame, report_period, metric):
    row = metric_record(frame, report_period, metric)
    if row["status"] != "ok" or pd.isna(row["value"]):
        reason = row["missing_reason"] if pd.notna(row["missing_reason"]) else row["status"]
        return np.nan, f"unavailable:{reason}"
    return float(row["value"]), "ok"


def latest_complete_period(frame, required_metrics, annual_only=False):
    if (
        "missing_reason" in frame.columns
        and frame["missing_reason"].eq("unsupported_financial_company").any()
    ):
        raise ValueError("unsupported_financial_company")
    periods = sorted(frame["report_period"].dropna().unique(), reverse=True)
    for period in periods:
        timestamp = pd.Timestamp(period)
        if annual_only and (timestamp.month != 12 or timestamp.day != 31):
            continue
        for metric in required_metrics:
            metric_value(frame, timestamp, metric)
        return timestamp
    scope = "annual" if annual_only else "any"
    raise ValueError(f"no_complete_{scope}_period:{','.join(required_metrics)}")


def latest_yield_pct(frame):
    usable = frame.dropna(subset=["value"]).sort_values("date")
    return float(usable.iloc[-1]["value"]) if len(usable) else np.nan`;

export const EQUITY_FCFF_HISTORY_SOURCE = `historical_metric_names = [
    "revenue", "revenueGrowthYoY", "nopatMargin", "returnOnInvestedCapital",
    "reinvestment", "freeCashFlowToFirm",
]
historical_rows = valuation_metrics[
    valuation_metrics["metric"].isin(historical_metric_names)
].copy()
historical_rows = historical_rows[
    (historical_rows["report_period"].dt.month == 12)
    & (historical_rows["report_period"].dt.day == 31)
]
historical_financials = historical_rows.pivot(
    index="report_period", columns="metric", values="value"
).reset_index().sort_values("report_period")
historical_financials["report_period"] = historical_financials["report_period"].dt.strftime("%Y-%m-%d")
historical_financials.tail(5)`;

export const EQUITY_FCFF_ASSUMPTION_SOURCE = `operating_required_metrics = [
    "revenue", "nopat", "nopatMargin", "returnOnInvestedCapital",
]
bridge_required_metrics = ["marketCapitalization", "enterpriseValue", "issuedShares"]
valuation_base_period = latest_complete_period(
    valuation_metrics, operating_required_metrics, annual_only=True
)
valuation_bridge_period = latest_complete_period(
    valuation_metrics, bridge_required_metrics, annual_only=False
)

valuation_base = {
    "period": valuation_base_period,
    "revenue": metric_value(valuation_metrics, valuation_base_period, "revenue"),
    "nopat": metric_value(valuation_metrics, valuation_base_period, "nopat"),
    "nopat_margin": metric_value(valuation_metrics, valuation_base_period, "nopatMargin"),
    "roic": metric_value(
        valuation_metrics, valuation_base_period, "returnOnInvestedCapital"
    ),
    "reinvestment": metric_optional_value(
        valuation_metrics, valuation_base_period, "reinvestment"
    )[0],
    "reinvestment_status": metric_optional_value(
        valuation_metrics, valuation_base_period, "reinvestment"
    )[1],
    "fcff": metric_optional_value(
        valuation_metrics, valuation_base_period, "freeCashFlowToFirm"
    )[0],
    "fcff_status": metric_optional_value(
        valuation_metrics, valuation_base_period, "freeCashFlowToFirm"
    )[1],
    "market_capitalization": metric_value(
        valuation_metrics, valuation_bridge_period, "marketCapitalization"
    ),
    "enterprise_value": metric_value(
        valuation_metrics, valuation_bridge_period, "enterpriseValue"
    ),
    "issued_shares": metric_value(
        valuation_metrics, valuation_bridge_period, "issuedShares"
    ),
}
valuation_bridge = {
    "net_claims_from_financial_kernel": (
        valuation_base["enterprise_value"] - valuation_base["market_capitalization"]
    ),
    "operating_cash_required": operating_cash_required_cny,
    "other_non_operating_assets": other_non_operating_assets_cny,
    "other_senior_claims": other_senior_claims_cny,
    "issued_shares": valuation_base["issued_shares"],
}
valuation_bridge["bridge_adjustment"] = (
    valuation_bridge["net_claims_from_financial_kernel"]
    + valuation_bridge["operating_cash_required"]
    + valuation_bridge["other_senior_claims"]
    - valuation_bridge["other_non_operating_assets"]
)

assumption_rows = [
    {
        "scenario": "all",
        "assumption": "base_revenue",
        "value": valuation_base["revenue"],
        "unit": "CNY",
        "start_date": valuation_base_period.strftime("%Y-%m-%d"),
        "horizon": "TTM at latest complete annual report",
        "source_kind": "historical_fact",
        "source_ref": "data.equity_financial_metrics:revenue",
        "rationale": "Audited starting revenue known on the valuation date.",
        "falsification": "A later source correction changes the selected annual report.",
    },
    {
        "scenario": "all",
        "assumption": "operating_cash_required",
        "value": operating_cash_required_cny,
        "unit": "CNY",
        "start_date": valuation_date,
        "horizon": "valuation bridge",
        "source_kind": "user_assumption",
        "source_ref": "parameter Cell",
        "rationale": "The financial statements do not identify required operating cash.",
        "falsification": "A cash-needs study supports a materially different amount.",
    },
]
for scenario in valuation_scenarios.to_dict("records"):
    for assumption, unit, rationale, falsification in [
        ("revenue_growth", "ratio", "Explicit top-line path.", "Reported revenue growth exits the scenario range."),
        ("target_nopat_margin", "ratio", "Explicit steady operating profitability.", "Reported NOPAT margin exits the scenario range."),
        ("incremental_capital_turnover", "ratio", "Revenue investment required per unit of growth.", "Observed reinvestment implies a materially different turnover."),
        ("wacc", "ratio", "User-selected discount rate; the CGB yield is reference only.", "Capital costs or business risk change materially."),
        ("terminal_growth", "ratio", "Explicit perpetual nominal growth.", "Long-run growth cannot be reconciled with the economy or reinvestment."),
        ("terminal_roic", "ratio", "Explicit return supporting terminal reinvestment.", "Observed mature-period returns contradict this level."),
    ]:
        assumption_rows.append({
            "scenario": scenario["scenario"],
            "assumption": assumption,
            "value": scenario[assumption],
            "unit": unit,
            "start_date": valuation_date,
            "horizon": f"{forecast_years} years plus terminal period",
            "source_kind": "user_assumption",
            "source_ref": "parameter Cell",
            "rationale": rationale,
            "falsification": falsification,
        })

valuation_assumptions = pd.DataFrame(assumption_rows)
valuation_assumptions`;

export const EQUITY_FCFF_MODEL_SOURCE = `valuation_base_inputs = pd.DataFrame([{
    "revenue": valuation_base["revenue"],
    "nopat_margin": valuation_base["nopat_margin"],
}])
valuation_bridge_inputs = pd.DataFrame([{
    "bridge_adjustment": valuation_bridge["bridge_adjustment"],
    "issued_shares": valuation_bridge["issued_shares"],
    "operating_cash_required": valuation_bridge["operating_cash_required"],
}])

valuation_helper_contract = pd.DataFrame([
    {
        "input": "base",
        "columns": "revenue, nopat_margin",
        "source_kind": "historical_fact",
    },
    {
        "input": "scenarios",
        "columns": "scenario, revenue_growth, target_nopat_margin, incremental_capital_turnover, wacc, terminal_growth, terminal_roic",
        "source_kind": "user_assumption",
    },
    {
        "input": "bridge",
        "columns": "bridge_adjustment, issued_shares, operating_cash_required",
        "source_kind": "historical_fact_and_user_assumption",
    },
])
valuation_helper_contract`;

export const EQUITY_FCFF_SCENARIO_SOURCE = `scenario_forecasts = valuation.fcff_scenarios(
    valuation_base_inputs,
    valuation_scenarios,
    valuation_bridge_inputs,
    forecast_years=forecast_years,
    terminal_value_warning_threshold=terminal_value_warning_threshold,
)
scenario_summary_columns = [
    "scenario", "enterprise_value", "bridge_adjustment", "equity_value",
    "issued_shares", "per_share_value_cny", "terminal_value_share",
    "terminal_reinvestment_rate", "diagnostics",
]
scenario_valuation = scenario_forecasts[
    scenario_summary_columns
].drop_duplicates().reset_index(drop=True)
market_price_per_share_cny = float(initial_quote["close"])
scenario_valuation["market_price_per_share_cny"] = market_price_per_share_cny
scenario_valuation["market_cap_per_reported_share_cny"] = valuation_base["market_capitalization"] / valuation_base["issued_shares"]
scenario_valuation["scenario_range_low_cny"] = scenario_valuation["per_share_value_cny"].min()
scenario_valuation["scenario_range_high_cny"] = scenario_valuation["per_share_value_cny"].max()
scenario_valuation`;

export const EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE = `base_scenario = valuation_scenarios[
    valuation_scenarios["scenario"] == "base"
].iloc[0].to_dict()
wacc_values = np.linspace(base_scenario["wacc"] - 0.02, base_scenario["wacc"] + 0.02, 5)
terminal_growth_values = np.linspace(
    max(0.0, base_scenario["terminal_growth"] - 0.01),
    base_scenario["terminal_growth"] + 0.01,
    5,
)
sensitivity_rows = []
for sensitivity_wacc in wacc_values:
    for sensitivity_growth in terminal_growth_values:
        sensitivity_scenario = dict(base_scenario)
        sensitivity_scenario["scenario"] = "sensitivity"
        sensitivity_scenario["wacc"] = float(sensitivity_wacc)
        sensitivity_scenario["terminal_growth"] = float(sensitivity_growth)
        try:
            sensitivity_forecast = valuation.fcff_scenarios(
                valuation_base_inputs,
                pd.DataFrame([sensitivity_scenario]),
                valuation_bridge_inputs,
                forecast_years=forecast_years,
                terminal_value_warning_threshold=terminal_value_warning_threshold,
            )
            sensitivity_rows.append({
                "wacc_pct": round(float(sensitivity_wacc) * 100, 2),
                "terminal_growth_pct": round(float(sensitivity_growth) * 100, 2),
                "per_share_value_cny": float(
                    sensitivity_forecast.iloc[0]["per_share_value_cny"]
                ),
                "status": "ok",
            })
        except ValueError as error:
            sensitivity_rows.append({
                "wacc_pct": round(float(sensitivity_wacc) * 100, 2),
                "terminal_growth_pct": round(float(sensitivity_growth) * 100, 2),
                "per_share_value_cny": np.nan,
                "status": str(error),
            })
sensitivity_table = pd.DataFrame(sensitivity_rows)
sensitivity_matrix = sensitivity_table.pivot(
    index="terminal_growth_pct", columns="wacc_pct", values="per_share_value_cny"
).reset_index()
sensitivity_matrix`;

export const EQUITY_FCFF_SENSITIVITY_CHART_SOURCE = `sensitivity_chart = charts.heatmap(
    sensitivity_table[sensitivity_table["status"] == "ok"],
    x="wacc_pct",
    y="terminal_growth_pct",
    value="per_share_value_cny",
    title="FCFF sensitivity: WACC × terminal growth",
    labels={
        "wacc_pct": "WACC (%)",
        "terminal_growth_pct": "Terminal growth (%)",
        "per_share_value_cny": "Per-share value (CNY)",
    },
)
sensitivity_chart`;

export const EQUITY_FCFF_REVERSE_SOURCE = `market_operating_enterprise_value = (
    valuation_base["market_capitalization"] + valuation_bridge["bridge_adjustment"]
)
reverse_valuation = valuation.implied_revenue_growth(
    valuation_base_inputs,
    pd.DataFrame([base_scenario]),
    valuation_bridge_inputs,
    target_enterprise_value=market_operating_enterprise_value,
    forecast_years=forecast_years,
    lower=reverse_growth_lower,
    upper=reverse_growth_upper,
    tolerance=reverse_growth_tolerance,
    minimum_value_span_fraction=reverse_minimum_value_span_fraction,
)
reverse_growth_result = reverse_valuation.iloc[0].to_dict()
reverse_growth_result["solution"] = reverse_growth_result["implied_value"]
reverse_valuation["market_price_per_share_cny"] = market_price_per_share_cny
reverse_valuation`;

export const EQUITY_FCFF_COMPARISON_SOURCE = `base_revenue_growth_fact = metric_value(
    valuation_metrics, valuation_base_period, "revenueGrowthYoY"
)
comparison_rows = [
    {
        "assumption": "revenue_growth",
        "value": base_revenue_growth_fact,
        "unit": "ratio",
        "source_kind": "historical_fact",
        "source_ref": f"annual report {valuation_base_period.date()}",
        "rationale": "Observed trailing growth, not a forecast.",
        "falsification": "A source correction changes the selected annual values.",
    },
    {
        "assumption": "revenue_growth",
        "value": float(base_scenario["revenue_growth"]),
        "unit": "ratio",
        "source_kind": "user_assumption",
        "source_ref": "base scenario parameter Cell",
        "rationale": "Explicit teaching assumption for the forward valuation.",
        "falsification": "Reported growth exits the declared scenario range.",
    },
    {
        "assumption": "revenue_growth",
        "value": reverse_growth_result["solution"],
        "unit": "ratio",
        "source_kind": "market_implied",
        "source_ref": f"market bridge at {valuation_date}",
        "rationale": "Single unknown solved with all other base assumptions frozen.",
        "falsification": reverse_growth_result["diagnostic"],
    },
]
fact_assumption_market_comparison = pd.DataFrame(comparison_rows)
fact_assumption_market_comparison`;

export const EQUITY_FCFF_REVIEW_SOURCE = `review_base_period = latest_complete_period(
    review_metrics, operating_required_metrics, annual_only=True
)
review_bridge_period = latest_complete_period(
    review_metrics, bridge_required_metrics, annual_only=False
)
review_base = {
    "period": review_base_period,
    "revenue": metric_value(review_metrics, review_base_period, "revenue"),
    "nopat": metric_value(review_metrics, review_base_period, "nopat"),
    "nopat_margin": metric_value(review_metrics, review_base_period, "nopatMargin"),
    "roic": metric_value(review_metrics, review_base_period, "returnOnInvestedCapital"),
    "reinvestment": metric_optional_value(
        review_metrics, review_base_period, "reinvestment"
    )[0],
    "reinvestment_status": metric_optional_value(
        review_metrics, review_base_period, "reinvestment"
    )[1],
    "fcff": metric_optional_value(
        review_metrics, review_base_period, "freeCashFlowToFirm"
    )[0],
    "fcff_status": metric_optional_value(
        review_metrics, review_base_period, "freeCashFlowToFirm"
    )[1],
    "market_capitalization": metric_value(
        review_metrics, review_bridge_period, "marketCapitalization"
    ),
    "enterprise_value": metric_value(
        review_metrics, review_bridge_period, "enterpriseValue"
    ),
    "issued_shares": metric_value(review_metrics, review_bridge_period, "issuedShares"),
}
review_bridge = {
    "net_claims_from_financial_kernel": (
        review_base["enterprise_value"] - review_base["market_capitalization"]
    ),
    "operating_cash_required": operating_cash_required_cny,
    "other_non_operating_assets": other_non_operating_assets_cny,
    "other_senior_claims": other_senior_claims_cny,
    "issued_shares": review_base["issued_shares"],
}
review_bridge["bridge_adjustment"] = (
    review_bridge["net_claims_from_financial_kernel"]
    + review_bridge["operating_cash_required"]
    + review_bridge["other_senior_claims"]
    - review_bridge["other_non_operating_assets"]
)
review_market_operating_enterprise_value = (
    review_base["market_capitalization"] + review_bridge["bridge_adjustment"]
)
review_base_inputs = pd.DataFrame([{
    "revenue": review_base["revenue"],
    "nopat_margin": review_base["nopat_margin"],
}])
review_bridge_inputs = pd.DataFrame([{
    "bridge_adjustment": review_bridge["bridge_adjustment"],
    "issued_shares": review_bridge["issued_shares"],
    "operating_cash_required": review_bridge["operating_cash_required"],
}])
review_reverse_valuation = valuation.implied_revenue_growth(
    review_base_inputs,
    pd.DataFrame([base_scenario]),
    review_bridge_inputs,
    target_enterprise_value=review_market_operating_enterprise_value,
    forecast_years=forecast_years,
    lower=reverse_growth_lower,
    upper=reverse_growth_upper,
    tolerance=reverse_growth_tolerance,
    minimum_value_span_fraction=reverse_minimum_value_span_fraction,
)
review_reverse_growth_result = review_reverse_valuation.iloc[0].to_dict()
review_reverse_growth_result["solution"] = review_reverse_growth_result["implied_value"]

first_year_by_scenario = scenario_forecasts[
    scenario_forecasts["year"] == 1
].set_index("scenario")
actual_growth = metric_value(review_metrics, review_base_period, "revenueGrowthYoY")
actual_margin = review_base["nopat_margin"]
actual_fcff = review_base["fcff"]

def range_assessment(actual, metric, availability="ok"):
    if availability != "ok" or pd.isna(actual):
        return availability
    lower = float(first_year_by_scenario.loc["downside", metric])
    upper = float(first_year_by_scenario.loc["upside", metric])
    minimum = min(lower, upper)
    maximum = max(lower, upper)
    return "inside_declared_range" if minimum <= actual <= maximum else "falsified_outside_range"


review_rows = [
    {
        "assumption": "revenue",
        "original_base": float(first_year_by_scenario.loc["base", "revenue"]),
        "original_downside": float(first_year_by_scenario.loc["downside", "revenue"]),
        "original_upside": float(first_year_by_scenario.loc["upside", "revenue"]),
        "actual": review_base["revenue"],
        "new_market_implied": np.nan,
        "unit": "CNY",
        "assessment": range_assessment(review_base["revenue"], "revenue"),
    },
    {
        "assumption": "nopat_margin",
        "original_base": float(first_year_by_scenario.loc["base", "nopat_margin"]),
        "original_downside": float(first_year_by_scenario.loc["downside", "nopat_margin"]),
        "original_upside": float(first_year_by_scenario.loc["upside", "nopat_margin"]),
        "actual": actual_margin,
        "new_market_implied": np.nan,
        "unit": "ratio",
        "assessment": range_assessment(actual_margin, "nopat_margin"),
    },
    {
        "assumption": "fcff",
        "original_base": float(first_year_by_scenario.loc["base", "fcff"]),
        "original_downside": float(first_year_by_scenario.loc["downside", "fcff"]),
        "original_upside": float(first_year_by_scenario.loc["upside", "fcff"]),
        "actual": actual_fcff,
        "new_market_implied": np.nan,
        "unit": "CNY",
        "assessment": range_assessment(actual_fcff, "fcff", review_base["fcff_status"]),
    },
    {
        "assumption": "revenue_growth",
        "original_base": float(base_scenario["revenue_growth"]),
        "original_downside": float(
            valuation_scenarios.set_index("scenario").loc["downside", "revenue_growth"]
        ),
        "original_upside": float(
            valuation_scenarios.set_index("scenario").loc["upside", "revenue_growth"]
        ),
        "actual": actual_growth,
        "new_market_implied": review_reverse_growth_result["solution"],
        "unit": "ratio",
        "assessment": (
            "inside_declared_range"
            if valuation_scenarios["revenue_growth"].min()
            <= actual_growth
            <= valuation_scenarios["revenue_growth"].max()
            else "falsified_outside_range"
        ),
    },
]
narrative_review = pd.DataFrame(review_rows)
narrative_review["initial_as_of"] = valuation_date
narrative_review["review_as_of"] = review_date
narrative_review["review_report_period"] = review_base_period.strftime("%Y-%m-%d")
narrative_review["new_reverse_status"] = review_reverse_growth_result["status"]
narrative_review["accounting_scope"] = "original_kernel_proxy; financial income and asset classifications require note review"
narrative_review`;

export function equityFcffValuationTemplate(): {
  title: string;
  cells: ResearchTemplateCellSeed[];
} {
  return {
    title: '五粮液 FCFF 估值闭环示例',
    cells: [
      {
        kind: 'markdown',
        source: `# 五粮液 FCFF 估值闭环示例

这是一份可编辑、可完整运行并可封存的教学模板。它把历史财报事实、用户假设和市场价格隐含假设分开记录，不代表平台目标价或买卖建议。

默认研究日为 2025-04-28，复查日为 2026-05-06，市场数据截止日为 2026-07-30。市场窗口为回顾性对照，基准为沪深300ETF（510300.SH）的复权收益。更换股票时先修改下一 Cell 的代码、日期和全部主观假设；一般工商业 FCFF 模型不适用于银行、保险和券商。`,
      },
      { kind: 'python', source: EQUITY_FCFF_PARAMETER_SOURCE },
      {
        kind: 'markdown',
        source: `## 公式与边界

预测期按“收入 → NOPAT → 再投资 → FCFF”展开：

- 收入按情景增长；NOPAT Margin 从历史值线性过渡到情景目标；
- 再投资 = 收入增加 / 增量资本周转率；FCFF = NOPAT - 再投资；
- 终值 FCFF = 下一期 NOPAT × (1 - 永续增长率 / 终值 ROIC)；
- 企业价值为预测期 FCFF 和终值的折现值；股权价值再扣除显式桥接项目；
- 永续增长率必须小于 WACC，一次反向估值只求一个未知量。

WACC、经营必需现金和未来经营参数都由用户负责，不会从历史数据自动冒充预测。`,
      },
      { kind: 'python', source: EQUITY_FCFF_DATA_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SELECTION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_HISTORY_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_ASSUMPTION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_MARKET_DATA_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_MODEL_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SCENARIO_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SENSITIVITY_CHART_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_REVERSE_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_COMPARISON_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_DURATION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_TERMINAL_SOURCE },
      {
        kind: 'markdown',
        source: `## 下一期财报复查

下面把原来的第一年情景与下一年报实际结果并排比较，并在其余基准假设不变时重新反解市场隐含收入增长。复查不是把旧判断改写成“当时就知道”，而是保留原假设、实际结果和新价格含义三套记录。`,
      },
      { kind: 'python', source: EQUITY_FCFF_REVIEW_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_CASH_RECONCILIATION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_ROLL_FORWARD_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_MARKET_REVIEW_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_MARKET_CHART_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_CUTOFF_SOURCE },
      {
        kind: 'markdown',
        source: `## 年报附注调整：保留原结果，单独对照

以下为有出处的**局部分类调整**，不是全部会计口径审计。原表与上方结果保留。原口径 FCFF 的“超出区间”不能直接归因于经营恶化。

从利润中剔除已识别资金收益，同时在营运资本、投入资本与股权桥接中处理对应资产；现金和交易性金融资产已在内核桥接，不重复加回。仅补入内核遗漏的非流动租赁负债。利息税负暂按集团有效税率分摊。

对照统一使用年报资产负债表和年报股本，不将年度附注套入最新季度；截止日行也是年报锚点敏感性，不是当前合理价。初始金融收益占收入的税后比例从所有目标利润率扣除，之后冻结这项换算，属于显式研究假设。另列“留存一个月收入现金＋新增金融资产折价10%”压力情景；受限现金只扣已识别最低额，剩余缺口见表。

更换标的时必须同步替换参数 Cell 中 classification_notes 的公司、年报、出处及可得日；缺少匹配附注时停止调整计算。`,
      },
      { kind: 'python', source: EQUITY_FCFF_CLASSIFICATION_METHODS_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_CLASSIFICATION_RECONCILIATION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_CLASSIFICATION_VALUATION_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_CLASSIFICATION_SOURCES_SOURCE },
      {
        kind: 'markdown',
        source: `## 阅读结论前

- 场景区间不是统计置信区间；三家公司不是独立样本外验证；
- 实际收盘价与“供应商总市值 / 财报股本”分列，后者可能受股本变动和 A/H 股口径影响；
- 期限敏感性固定历史利润率，避免变更预测年数时同时改变利润率过渡速度；
- 原路径滚动是企业现金流模型的一年恒等式，不等于股东实际一年收益；
- 现金流差额不自动解释为维护性或扩张性投入，仍需年报附注；
- 更新估值仅替换可得财报，沿用原教学参数，原假设被推翻后应单独修订并保留旧快照；
- 终值占比过高说明答案主要依赖远期假设；
- 当前价格的反向解只是给定其余假设后的一个等价解释，不是市场唯一叙事；
- 若数据版本、经营假设或桥接项目变化，应让下游 Cell 进入待重跑并重新完成一次干净全文运行；
- 需要保留本次证据时，在完整运行历史中封存 ResearchExecution。`,
      },
    ],
  };
}
