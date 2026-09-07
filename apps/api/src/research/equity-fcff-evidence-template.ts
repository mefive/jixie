export const EQUITY_FCFF_MARKET_DATA_SOURCE = `def exact_quote(identifier, date):
    snapshot = data.cross_section(
        "cn_a", date=date, minimum_listed_days=0, risk_warning="include"
    )
    rows = snapshot[snapshot["code"] == identifier]
    if len(rows) != 1 or pd.Timestamp(rows.iloc[0]["date"]) != pd.Timestamp(date):
        raise ValueError(f"missing_exact_date_quote:{identifier}:{date}")
    quote = rows.iloc[0]
    if pd.isna(quote["close"]) or quote["close"] <= 0:
        raise ValueError(f"invalid_quote:{identifier}:{date}")
    return quote


initial_quote = exact_quote(valuation_identifier, valuation_date)
review_quote = exact_quote(valuation_identifier, review_date)
cutoff_quote = exact_quote(valuation_identifier, market_cutoff_date)
stock_market_series = data.series(
    "stock", valuation_identifier, start=valuation_date, end=market_cutoff_date
)
benchmark_market_series = data.series(
    "etf", benchmark_identifier, start=valuation_date, end=market_cutoff_date
)
cutoff_metrics = data.equity_financial_metrics(valuation_identifier, as_of=market_cutoff_date)
market_audit_rows = []
for stage, date, quote, metrics in [
    ("initial", valuation_date, initial_quote, valuation_metrics),
    ("review", review_date, review_quote, review_metrics),
    ("cutoff", market_cutoff_date, cutoff_quote, cutoff_metrics),
]:
    bridge_period = latest_complete_period(metrics, bridge_required_metrics)
    reported_shares = metric_value(metrics, bridge_period, "issuedShares")
    market_cap = metric_value(metrics, bridge_period, "marketCapitalization")
    if not np.isclose(market_cap, float(quote["total_market_cap_cny_10k"]) * 10000, rtol=1e-10):
        raise ValueError("market_capitalization_date_mismatch")
    market_audit_rows.append({
        "stage": stage, "date": date, "actual_close_cny": float(quote["close"]),
        "market_cap_per_reported_share_cny": market_cap / reported_shares,
        "reported_shares": reported_shares, "share_report_period": bridge_period,
        "share_proxy_difference": market_cap / reported_shares / float(quote["close"]) - 1,
        "basis": "Provider total capitalization; reported shares can be stale. Not an A+H capitalization audit.",
    })
market_data_audit = pd.DataFrame(market_audit_rows)
market_data_audit`;

export const EQUITY_FCFF_DURATION_SOURCE = `duration_rows = []
for duration_years in [3, 5, 10]:
    duration_scenario = dict(base_scenario)
    duration_scenario["scenario"] = f"growth_{duration_years}_years"
    # A flat historical margin isolates duration from the helper's horizon-dependent margin ramp.
    duration_scenario["target_nopat_margin"] = valuation_base["nopat_margin"]
    duration_summary = valuation.fcff_scenarios(
        valuation_base_inputs, pd.DataFrame([duration_scenario]), valuation_bridge_inputs,
        forecast_years=duration_years,
    ).iloc[0]
    duration_rows.append({
        "growth_years": duration_years,
        "constant_nopat_margin": valuation_base["nopat_margin"],
        "per_share_value_cny": float(duration_summary["per_share_value_cny"]),
        "terminal_value_share": float(duration_summary["terminal_value_share"]),
        "basis": "Same growth, historical flat margin, capital turnover, discount and terminal assumptions",
    })
growth_duration_comparison = pd.DataFrame(duration_rows)
growth_duration_comparison`;

export const EQUITY_FCFF_TERMINAL_SOURCE = `terminal_rows = []
for terminal_case in ["zero_growth", "return_equals_cost", "persistent_excess_return"]:
    terminal_scenario = dict(base_scenario)
    terminal_scenario["scenario"] = terminal_case
    if terminal_case == "zero_growth":
        terminal_scenario["terminal_growth"] = 0.0
    elif terminal_case == "return_equals_cost":
        terminal_scenario["terminal_roic"] = terminal_scenario["wacc"]
    terminal_summary = valuation.fcff_scenarios(
        valuation_base_inputs, pd.DataFrame([terminal_scenario]), valuation_bridge_inputs,
        forecast_years=forecast_years,
    ).iloc[0]
    terminal_rows.append({
        "terminal_case": terminal_case,
        "growth": terminal_scenario["terminal_growth"],
        "roic": terminal_scenario["terminal_roic"],
        "wacc": terminal_scenario["wacc"],
        "reinvestment_rate": float(terminal_summary["terminal_reinvestment_rate"]),
        "per_share_value_cny": float(terminal_summary["per_share_value_cny"]),
        "terminal_value_share": float(terminal_summary["terminal_value_share"]),
    })
terminal_stress_comparison = pd.DataFrame(terminal_rows)
terminal_stress_comparison`;

export const EQUITY_FCFF_CASH_RECONCILIATION_SOURCE = `cash_metric_names = [
    "revenue", "nopat", "operatingCashFlow", "operatingCashFlowToNetIncome",
    "netCapitalExpenditure", "changeInWorkingCapital", "reinvestment",
    "freeCashFlowToFirm", "cashFreeCashFlow", "returnOnInvestedCapital",
]
cash_rows = review_metrics[
    review_metrics["metric"].isin(cash_metric_names)
    & review_metrics["report_period"].dt.strftime("%m%d").eq("1231")
].copy()
cash_reconciliation = cash_rows.pivot(index="report_period", columns="metric", values="value").tail(5)
annual_net_income = review_statements[
    review_statements["statement_kind"].eq("income") & review_statements["field"].eq("nIncome")
].set_index("report_period")["value"]
cash_reconciliation["net_income"] = annual_net_income
cash_reconciliation["profit_to_cash_gap"] = cash_reconciliation["operatingCashFlow"] - cash_reconciliation["net_income"]
cash_reconciliation["fcff_vs_cash_free_cash_flow"] = cash_reconciliation["freeCashFlowToFirm"] - cash_reconciliation["cashFreeCashFlow"]
cash_reconciliation["as_of_date"] = review_date
cash_reconciliation["fcff_identity_residual"] = (
    cash_reconciliation["nopat"] - cash_reconciliation["reinvestment"] - cash_reconciliation["freeCashFlowToFirm"]
)
cash_reconciliation["cash_flow_vs_nopat_gap"] = cash_reconciliation["operatingCashFlow"] - cash_reconciliation["nopat"]
cash_reconciliation["cash_capex"] = cash_reconciliation["operatingCashFlow"] - cash_reconciliation["cashFreeCashFlow"]
cash_reconciliation["depreciation_amortization"] = cash_reconciliation["cash_capex"] - cash_reconciliation["netCapitalExpenditure"]
cash_reconciliation["unavailable_inputs"] = cash_rows.groupby("report_period").apply(
    lambda group: "; ".join(
        f"{row['metric']}:{row['missing_reason']}" for row in group.to_dict("records") if row["status"] != "ok"
    ), include_groups=False,
)
cash_reconciliation = cash_reconciliation.reset_index()
cash_reconciliation`;

export const EQUITY_FCFF_ROLL_FORWARD_SOURCE = `elapsed_report_years = review_base_period.year - valuation_base_period.year
if elapsed_report_years != 1 or forecast_years <= 1:
    raise ValueError("roll_forward_requires_exactly_one_annual_report_and_at_least_two_forecast_years")

original_path = scenario_forecasts[scenario_forecasts["scenario"] == "base"].sort_values("year")
original_enterprise_value = float(original_path.iloc[0]["enterprise_value"])
first_cash_flow = float(original_path.iloc[0]["fcff"])
# Roll the frozen cash-flow path; do not restart its margin transition from the observed margin.
frozen_remaining_enterprise_value = original_enterprise_value * (1 + base_scenario["wacc"]) - first_cash_flow
frozen_roll_return = (frozen_remaining_enterprise_value + first_cash_flow) / original_enterprise_value - 1
rolled_rows = [{
    "case": "original_path_remaining_four_years",
    "forecast_years": forecast_years - 1,
    "enterprise_value": frozen_remaining_enterprise_value,
    "per_share_value_cny": np.nan,
    "basis": "Expected one model-year roll; no actual equity distribution or calendar-day return claim",
}]
for remaining_years in [forecast_years - 1, forecast_years]:
    # Hold observed margin flat in both updates to isolate the extra year's effect.
    fixed_margin_scenario = dict(base_scenario)
    fixed_margin_scenario["target_nopat_margin"] = review_base["nopat_margin"]
    updated = valuation.fcff_scenarios(
        review_base_inputs, pd.DataFrame([fixed_margin_scenario]), review_bridge_inputs,
        forecast_years=remaining_years,
    ).iloc[0]
    rolled_rows.append({
        "case": f"observed_base_flat_margin_{remaining_years}_years",
        "forecast_years": remaining_years,
        "enterprise_value": float(updated["enterprise_value"]),
        "per_share_value_cny": float(updated["per_share_value_cny"]),
        "basis": "Same observed base, flat margin and bridge; only growth duration changes",
    })
roll_forward_comparison = pd.DataFrame(rolled_rows)
roll_forward_comparison["frozen_path_model_year_return"] = frozen_roll_return
roll_forward_comparison`;

export const EQUITY_FCFF_MARKET_REVIEW_SOURCE = `def aligned_market_observations(stock_frame, benchmark_frame, start_date, cutoff_date):
    for frame in [stock_frame, benchmark_frame]:
        if frame["date"].duplicated().any() or frame["value"].isna().any() or (frame["value"] <= 0).any():
            raise ValueError("invalid_market_series")
    aligned = stock_frame.rename(columns={"value": "stock"}).merge(
        benchmark_frame.rename(columns={"value": "benchmark"}), on="date", how="outer", validate="one_to_one"
    ).sort_values("date")
    aligned = aligned[(aligned["date"] >= pd.Timestamp(start_date)) & (aligned["date"] <= pd.Timestamp(cutoff_date))]
    if aligned.empty or aligned.iloc[0]["date"] != pd.Timestamp(start_date) or aligned.iloc[-1]["date"] != pd.Timestamp(cutoff_date):
        raise ValueError("missing_market_window_endpoint")
    if aligned[["stock", "benchmark"]].isna().any().any():
        raise ValueError("unmatched_market_dates_requires_review")
    return aligned.reset_index(drop=True)


def market_window_summary(observations, start_date, cutoff_date, months):
    target = pd.Timestamp(start_date) + pd.DateOffset(months=months)
    if target > pd.Timestamp(cutoff_date):
        return {"months": months, "target_date": target, "status": "not_yet_observed"}
    endpoints = observations[observations["date"] >= target]
    if endpoints.empty:
        return {"months": months, "target_date": target, "status": "missing_window_endpoint"}
    end_date = endpoints.iloc[0]["date"]
    if (end_date - target).days > 10:
        return {"months": months, "target_date": target, "status": "stale_window_endpoint"}
    window = observations[observations["date"] <= end_date]
    stock_return = float(window.iloc[-1]["stock"] / window.iloc[0]["stock"] - 1)
    benchmark_return = float(window.iloc[-1]["benchmark"] / window.iloc[0]["benchmark"] - 1)
    return {
        "months": months, "target_date": target, "actual_end_date": end_date, "status": "observed_retrospective",
        "stock_adjusted_return": stock_return, "benchmark_adjusted_return": benchmark_return,
        "return_difference": stock_return - benchmark_return,
        "stock_max_drawdown": float((window["stock"] / window["stock"].cummax() - 1).min()),
        "observations": len(window),
    }


market_observations = aligned_market_observations(
    stock_market_series, benchmark_market_series, valuation_date, market_cutoff_date
)
market_window_review = pd.DataFrame([
    market_window_summary(market_observations, valuation_date, market_cutoff_date, months)
    for months in [3, 6, 12]
])
market_window_review["initial_base_value_to_quote_gap"] = float(
    scenario_valuation[scenario_valuation["scenario"] == "base"].iloc[0]["per_share_value_cny"]
) / float(initial_quote["close"]) - 1
market_window_review["benchmark"] = benchmark_identifier
market_window_review["return_basis"] = "close_times_adjustment_factor; no extra dividend addition; before investor trading costs"
market_window_review["evidence_scope"] = "Three selected retrospective cases; not independent holdout or predictive validation"
market_window_review`;

export const EQUITY_FCFF_MARKET_CHART_SOURCE = `market_comparison_chart_data = market_observations.copy()
for series_name in ["stock", "benchmark"]:
    market_comparison_chart_data[series_name] = market_comparison_chart_data[series_name] / market_comparison_chart_data.iloc[0][series_name]
charts.line(market_comparison_chart_data, x="date", y=["stock", "benchmark"], title="Retrospective adjusted wealth comparison (initial = 1)")`;

export const EQUITY_FCFF_CUTOFF_SOURCE = `cutoff_annual_period = latest_complete_period(cutoff_metrics, operating_required_metrics, annual_only=True)
cutoff_bridge_period = latest_complete_period(cutoff_metrics, bridge_required_metrics)
cutoff_inputs = pd.DataFrame([{
    "revenue": metric_value(cutoff_metrics, cutoff_annual_period, "revenue"),
    "nopat_margin": metric_value(cutoff_metrics, cutoff_annual_period, "nopatMargin"),
}])
cutoff_bridge = pd.DataFrame([{
    "bridge_adjustment": metric_value(cutoff_metrics, cutoff_bridge_period, "enterpriseValue") - metric_value(cutoff_metrics, cutoff_bridge_period, "marketCapitalization") + operating_cash_required_cny + other_senior_claims_cny - other_non_operating_assets_cny,
    "issued_shares": metric_value(cutoff_metrics, cutoff_bridge_period, "issuedShares"),
    "operating_cash_required": operating_cash_required_cny,
}])
cutoff_valuation = valuation.fcff_scenarios(
    cutoff_inputs, valuation_scenarios, cutoff_bridge, forecast_years=forecast_years,
)
cutoff_first_year = cutoff_valuation[cutoff_valuation["year"].eq(1)].set_index("scenario")
cutoff_valuation = cutoff_valuation[scenario_summary_columns].drop_duplicates().reset_index(drop=True)
for forecast_metric in ["revenue", "nopat_margin", "fcff"]:
    cutoff_valuation[f"next_year_{forecast_metric}"] = cutoff_valuation["scenario"].map(cutoff_first_year[forecast_metric])
cutoff_valuation["next_report_year"] = cutoff_annual_period.year + 1
cutoff_valuation["as_of_date"] = market_cutoff_date
cutoff_valuation["annual_report_period"] = cutoff_annual_period
cutoff_valuation["actual_close_cny"] = float(cutoff_quote["close"])
cutoff_valuation["assumption_policy"] = "Original teaching scenarios unchanged; updated facts only, not a new forecast endorsement"
cutoff_valuation["next_review"] = "Next annual report: revenue growth, margin and FCFF versus year-one scenario range; reassess cash needs and capital claims"
cutoff_valuation`;
