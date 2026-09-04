export interface ResearchTemplateCellSeed {
  kind: 'markdown' | 'python';
  source: string;
}

export const EQUITY_FCFF_PARAMETER_SOURCE = `valuation_identifier = "000858.SZ"
valuation_date = "20250428"
review_date = "20260506"
forecast_years = 5

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
    {
        "scenario": "downside",
        "revenue_growth": 0.00,
        "target_nopat_margin": 0.33,
        "incremental_capital_turnover": 1.25,
        "wacc": 0.085,
        "terminal_growth": 0.010,
        "terminal_roic": 0.14,
    },
    {
        "scenario": "base",
        "revenue_growth": 0.04,
        "target_nopat_margin": 0.36,
        "incremental_capital_turnover": 1.50,
        "wacc": 0.075,
        "terminal_growth": 0.015,
        "terminal_roic": 0.18,
    },
    {
        "scenario": "upside",
        "revenue_growth": 0.08,
        "target_nopat_margin": 0.38,
        "incremental_capital_turnover": 1.75,
        "wacc": 0.065,
        "terminal_growth": 0.020,
        "terminal_roic": 0.22,
    },
])
valuation_scenarios`;

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
        complete = True
        for metric in required_metrics:
            rows = frame[(frame["report_period"] == timestamp) & (frame["metric"] == metric)]
            if len(rows) != 1 or rows.iloc[0]["status"] != "ok" or pd.isna(rows.iloc[0]["value"]):
                complete = False
                break
        if complete:
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
    "reinvestment", "freeCashFlowToFirm",
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
    "reinvestment": metric_value(
        valuation_metrics, valuation_base_period, "reinvestment"
    ),
    "fcff": metric_value(
        valuation_metrics, valuation_base_period, "freeCashFlowToFirm"
    ),
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

export const EQUITY_FCFF_MODEL_SOURCE = `def require_finite(name, value):
    number = float(value)
    if not np.isfinite(number):
        raise ValueError(f"non_finite_input:{name}")
    return number


def validate_dcf_inputs(base, scenario, bridge, years):
    if int(years) != years or years < 1 or years > 20:
        raise ValueError("forecast_years_must_be_between_1_and_20")
    revenue = require_finite("base_revenue", base["revenue"])
    base_margin = require_finite("base_nopat_margin", base["nopat_margin"])
    growth = require_finite("revenue_growth", scenario["revenue_growth"])
    target_margin = require_finite("target_nopat_margin", scenario["target_nopat_margin"])
    capital_turnover = require_finite(
        "incremental_capital_turnover", scenario["incremental_capital_turnover"]
    )
    wacc = require_finite("wacc", scenario["wacc"])
    terminal_growth = require_finite("terminal_growth", scenario["terminal_growth"])
    terminal_roic = require_finite("terminal_roic", scenario["terminal_roic"])
    issued_shares = require_finite("issued_shares", bridge["issued_shares"])
    require_finite("bridge_adjustment", bridge["bridge_adjustment"])
    if revenue <= 0:
        raise ValueError("base_revenue_must_be_positive")
    if growth <= -1:
        raise ValueError("revenue_growth_must_be_greater_than_minus_one")
    if not -1 < base_margin < 1 or not -1 < target_margin < 1:
        raise ValueError("nopat_margin_must_be_between_minus_one_and_one")
    if capital_turnover <= 0:
        raise ValueError("incremental_capital_turnover_must_be_positive")
    if wacc <= -1:
        raise ValueError("wacc_must_be_greater_than_minus_one")
    if terminal_growth < 0:
        raise ValueError("terminal_growth_must_be_non_negative")
    if terminal_growth >= wacc:
        raise ValueError("terminal_growth_must_be_less_than_wacc")
    if terminal_roic <= terminal_growth:
        raise ValueError("terminal_roic_must_exceed_terminal_growth")
    if issued_shares <= 0:
        raise ValueError("issued_shares_must_be_positive")


def value_fcff_scenario(base, scenario, bridge, years, terminal_share_threshold=0.75):
    validate_dcf_inputs(base, scenario, bridge, years)
    scenario_name = str(scenario.get("scenario", "scenario"))
    revenue_growth = float(scenario["revenue_growth"])
    target_margin = float(scenario["target_nopat_margin"])
    capital_turnover = float(scenario["incremental_capital_turnover"])
    wacc = float(scenario["wacc"])
    terminal_growth = float(scenario["terminal_growth"])
    terminal_roic = float(scenario["terminal_roic"])

    previous_revenue = float(base["revenue"])
    rows = []
    for year in range(1, int(years) + 1):
        revenue = previous_revenue * (1 + revenue_growth)
        nopat_margin = float(base["nopat_margin"]) + (
            target_margin - float(base["nopat_margin"])
        ) * year / int(years)
        nopat = revenue * nopat_margin
        reinvestment = (revenue - previous_revenue) / capital_turnover
        fcff = nopat - reinvestment
        discount_factor = (1 + wacc) ** year
        rows.append({
            "scenario": scenario_name,
            "year": year,
            "revenue": revenue,
            "nopat_margin": nopat_margin,
            "nopat": nopat,
            "reinvestment": reinvestment,
            "fcff": fcff,
            "present_value_fcff": fcff / discount_factor,
        })
        previous_revenue = revenue

    terminal_revenue = previous_revenue * (1 + terminal_growth)
    terminal_nopat = terminal_revenue * target_margin
    terminal_reinvestment_rate = terminal_growth / terminal_roic
    terminal_fcff = terminal_nopat * (1 - terminal_reinvestment_rate)
    terminal_value = terminal_fcff / (wacc - terminal_growth)
    present_value_terminal = terminal_value / ((1 + wacc) ** int(years))
    enterprise_value = sum(row["present_value_fcff"] for row in rows) + present_value_terminal
    equity_value = enterprise_value - float(bridge["bridge_adjustment"])
    per_share_value = equity_value / float(bridge["issued_shares"])
    terminal_value_share = (
        present_value_terminal / enterprise_value if enterprise_value != 0 else np.nan
    )
    diagnostics = []
    if np.isfinite(terminal_value_share) and terminal_value_share > terminal_share_threshold:
        diagnostics.append("high_terminal_value_share")
    if equity_value <= 0:
        diagnostics.append("non_positive_equity_value")
    if float(bridge.get("operating_cash_required", 0.0)) == 0:
        diagnostics.append("operating_cash_assumption_requires_review")

    summary = {
        "scenario": scenario_name,
        "enterprise_value": enterprise_value,
        "bridge_adjustment": float(bridge["bridge_adjustment"]),
        "equity_value": equity_value,
        "issued_shares": float(bridge["issued_shares"]),
        "per_share_value_cny": per_share_value,
        "terminal_value_share": terminal_value_share,
        "terminal_reinvestment_rate": terminal_reinvestment_rate,
        "diagnostics": "ok" if not diagnostics else ";".join(diagnostics),
    }
    return pd.DataFrame(rows), summary


def solve_single_parameter(
    target_value,
    value_function,
    lower,
    upper,
    tolerance=1e-8,
    minimum_value_span_fraction=0.05,
    grid_points=401,
):
    target = require_finite("target_value", target_value)
    lower_bound = require_finite("lower_bound", lower)
    upper_bound = require_finite("upper_bound", upper)
    if lower_bound >= upper_bound:
        raise ValueError("reverse_bounds_must_be_in_ascending_order")
    grid = np.linspace(lower_bound, upper_bound, int(grid_points))
    values = np.array([float(value_function(point)) for point in grid], dtype=float)
    if not np.isfinite(values).all():
        return {
            "status": "non_finite_scan",
            "solution": np.nan,
            "diagnostic": "valuation_function_returned_non_finite_values",
        }
    value_span_fraction = (values.max() - values.min()) / max(abs(target), 1.0)
    if value_span_fraction < minimum_value_span_fraction:
        return {
            "status": "weakly_identified",
            "solution": np.nan,
            "diagnostic": "valuation_changes_too_little_across_search_bounds",
        }

    residuals = values - target
    exact_roots = [float(grid[index]) for index in np.where(np.abs(residuals) <= tolerance)[0]]
    brackets = []
    for index in range(len(grid) - 1):
        if residuals[index] * residuals[index + 1] < 0:
            brackets.append((float(grid[index]), float(grid[index + 1])))

    roots = list(exact_roots)
    for bracket_lower, bracket_upper in brackets:
        left = bracket_lower
        right = bracket_upper
        left_residual = float(value_function(left)) - target
        for _ in range(200):
            midpoint = (left + right) / 2
            midpoint_residual = float(value_function(midpoint)) - target
            if abs(midpoint_residual) <= tolerance or right - left <= tolerance:
                break
            if left_residual * midpoint_residual <= 0:
                right = midpoint
            else:
                left = midpoint
                left_residual = midpoint_residual
        roots.append(float(midpoint))

    unique_roots = []
    for root in sorted(roots):
        if not unique_roots or abs(root - unique_roots[-1]) > max(tolerance * 10, 1e-7):
            unique_roots.append(root)
    if len(unique_roots) == 0:
        return {
            "status": "no_solution",
            "solution": np.nan,
            "diagnostic": "target_value_not_bracketed",
        }
    if len(unique_roots) > 1:
        return {
            "status": "multiple_solutions",
            "solution": np.nan,
            "diagnostic": f"found_{len(unique_roots)}_solutions",
        }
    return {
        "status": "solved",
        "solution": unique_roots[0],
        "diagnostic": "unique_solution_within_declared_bounds",
    }`;

export const EQUITY_FCFF_SCENARIO_SOURCE = `scenario_forecast_frames = []
scenario_valuation_rows = []
scenario_diagnostic_rows = []
for scenario in valuation_scenarios.to_dict("records"):
    try:
        forecast_frame, valuation_summary = value_fcff_scenario(
            valuation_base,
            scenario,
            valuation_bridge,
            forecast_years,
            terminal_value_warning_threshold,
        )
        scenario_forecast_frames.append(forecast_frame)
        scenario_valuation_rows.append(valuation_summary)
    except ValueError as error:
        scenario_diagnostic_rows.append({
            "scenario": scenario["scenario"],
            "status": "invalid",
            "diagnostic": str(error),
        })

if not scenario_forecast_frames:
    raise ValueError("all_valuation_scenarios_are_invalid")
scenario_forecasts = pd.concat(scenario_forecast_frames, ignore_index=True)
scenario_valuation = pd.DataFrame(scenario_valuation_rows)
scenario_diagnostics = pd.DataFrame(scenario_diagnostic_rows)
market_price_per_share_cny = (
    valuation_base["market_capitalization"] / valuation_base["issued_shares"]
)
scenario_valuation["market_price_per_share_cny"] = market_price_per_share_cny
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
            _, sensitivity_summary = value_fcff_scenario(
                valuation_base,
                sensitivity_scenario,
                valuation_bridge,
                forecast_years,
                terminal_value_warning_threshold,
            )
            sensitivity_rows.append({
                "wacc_pct": round(float(sensitivity_wacc) * 100, 2),
                "terminal_growth_pct": round(float(sensitivity_growth) * 100, 2),
                "per_share_value_cny": sensitivity_summary["per_share_value_cny"],
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

def enterprise_value_for_revenue_growth(revenue_growth):
    reverse_scenario = dict(base_scenario)
    reverse_scenario["scenario"] = "reverse"
    reverse_scenario["revenue_growth"] = float(revenue_growth)
    _, reverse_summary = value_fcff_scenario(
        valuation_base,
        reverse_scenario,
        valuation_bridge,
        forecast_years,
        terminal_value_warning_threshold,
    )
    return reverse_summary["enterprise_value"]


reverse_growth_result = solve_single_parameter(
    market_operating_enterprise_value,
    enterprise_value_for_revenue_growth,
    reverse_growth_lower,
    reverse_growth_upper,
    reverse_growth_tolerance,
    reverse_minimum_value_span_fraction,
)
reverse_valuation = pd.DataFrame([{
    "parameter": "revenue_growth",
    "status": reverse_growth_result["status"],
    "implied_value": reverse_growth_result["solution"],
    "unit": "ratio",
    "lower_bound": reverse_growth_lower,
    "upper_bound": reverse_growth_upper,
    "target_operating_enterprise_value_cny": market_operating_enterprise_value,
    "market_price_per_share_cny": market_price_per_share_cny,
    "diagnostic": reverse_growth_result["diagnostic"],
}])
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
    "reinvestment": metric_value(review_metrics, review_base_period, "reinvestment"),
    "fcff": metric_value(review_metrics, review_base_period, "freeCashFlowToFirm"),
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

def review_enterprise_value_for_growth(revenue_growth):
    review_scenario = dict(base_scenario)
    review_scenario["scenario"] = "review_reverse"
    review_scenario["revenue_growth"] = float(revenue_growth)
    _, review_summary = value_fcff_scenario(
        review_base,
        review_scenario,
        review_bridge,
        forecast_years,
        terminal_value_warning_threshold,
    )
    return review_summary["enterprise_value"]


review_market_operating_enterprise_value = (
    review_base["market_capitalization"] + review_bridge["bridge_adjustment"]
)
review_reverse_growth_result = solve_single_parameter(
    review_market_operating_enterprise_value,
    review_enterprise_value_for_growth,
    reverse_growth_lower,
    reverse_growth_upper,
    reverse_growth_tolerance,
    reverse_minimum_value_span_fraction,
)

first_year_by_scenario = scenario_forecasts[
    scenario_forecasts["year"] == 1
].set_index("scenario")
actual_growth = metric_value(review_metrics, review_base_period, "revenueGrowthYoY")
actual_margin = review_base["nopat_margin"]
actual_fcff = review_base["fcff"]

def range_assessment(actual, metric):
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
        "assessment": range_assessment(actual_fcff, "fcff"),
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

默认研究日为 2025-04-28，复查日为 2026-05-06。更换股票时先修改下一 Cell 的代码、日期和全部主观假设；一般工商业 FCFF 模型不适用于银行、保险和券商。`,
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
      { kind: 'python', source: EQUITY_FCFF_MODEL_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SCENARIO_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SENSITIVITY_TABLE_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_SENSITIVITY_CHART_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_REVERSE_SOURCE },
      { kind: 'python', source: EQUITY_FCFF_COMPARISON_SOURCE },
      {
        kind: 'markdown',
        source: `## 下一期财报复查

下面把原来的第一年情景与下一年报实际结果并排比较，并在其余基准假设不变时重新反解市场隐含收入增长。复查不是把旧判断改写成“当时就知道”，而是保留原假设、实际结果和新价格含义三套记录。`,
      },
      { kind: 'python', source: EQUITY_FCFF_REVIEW_SOURCE },
      {
        kind: 'markdown',
        source: `## 阅读结论前

- 场景区间不是统计置信区间；
- 终值占比过高说明答案主要依赖远期假设；
- 当前价格的反向解只是给定其余假设后的一个等价解释，不是市场唯一叙事；
- 若数据版本、经营假设或桥接项目变化，应让下游 Cell 进入待重跑并重新完成一次干净全文运行；
- 需要保留本次证据时，在完整运行历史中封存 ResearchExecution。`,
      },
    ],
  };
}
