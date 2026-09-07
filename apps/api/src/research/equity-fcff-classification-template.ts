export const EQUITY_FCFF_CLASSIFICATION_METHODS_SOURCE = `def selected_classification_note(period, as_of):
    matches = [note for note in classification_notes
               if note["identifier"] == valuation_identifier
               and pd.Timestamp(note["period"]) == pd.Timestamp(period)
               and pd.Timestamp(note["availableDate"]) <= pd.Timestamp(as_of)]
    if len(matches) != 1:
        raise ValueError("classification_note_missing_or_ambiguous_for_as_of")
    return matches[0]


def classification_amounts(note, column):
    scale = {"CNY": 1.0, "CNY_thousand": 1000.0}[note["sourceUnit"]]
    values = {item["item"]: float(item[column]) * scale for item in note["items"]}
    if len(values) != len(note["items"]) or not all(np.isfinite(list(values.values()))):
        raise ValueError("invalid_or_duplicate_classification_amount")
    # Zero here means no adjustment in the declared scope, never verified absence.
    current_assets = sum(values.get(key, 0.0) for key in ["fixed_short", "fixed_maturing", "cd_current"])
    extra_assets = sum(values.get(key, 0.0) for key in [
        "fixed_short", "fixed_long_including_maturing", "cd_total", "noncurrent_equity"
    ]) - values.get("pooled_impairment_reserve", 0.0)
    if values.get("fixed_maturing", 0.0) > values.get("fixed_long_including_maturing", 0.0):
        raise ValueError("maturing_products_exceed_inclusive_total")
    income = sum(values.get(key, 0.0) for key in [
        "interest_income", "trading_disposal_income", "trading_holding_income",
        "equity_fair_value_income", "product_fair_value_income"
    ])
    return {"current_assets": current_assets, "extra_assets": extra_assets,
            "income": income, "lease": values.get("noncurrent_lease", 0.0),
            "restricted_minimum": values.get("restricted_cash_minimum", 0.0)}


def annual_classification(frame, period, as_of):
    note = selected_classification_note(period, as_of)
    current = classification_amounts(note, "current")
    previous = classification_amounts(note, "previous")
    prior_period = pd.Timestamp(period) - pd.DateOffset(years=1)
    tax = metric_value(frame, period, "effectiveTaxRate")
    revenue = metric_value(frame, period, "revenue")
    income_after_tax = current["income"] * (1.0 - tax)
    nopat = metric_value(frame, period, "nopat") - income_after_tax
    original_fcff, fcff_status = metric_optional_value(frame, period, "freeCashFlowToFirm")
    removed_current_asset_change = current["current_assets"] - previous["current_assets"]
    current_capital = metric_value(frame, period, "investedCapital") - current["extra_assets"] + current["lease"]
    prior_capital = metric_value(frame, prior_period, "investedCapital") - previous["extra_assets"] + previous["lease"]
    average_capital = (current_capital + prior_capital) / 2.0
    return {
        "report_period": pd.Timestamp(period).strftime("%Y-%m-%d"),
        "as_of": as_of, "revenue": revenue,
        "original_nopat_cny": metric_value(frame, period, "nopat"),
        "removed_income_after_tax_cny": income_after_tax,
        "partial_nopat_cny": nopat, "partial_nopat_margin": nopat / revenue,
        "removed_current_asset_change_cny": removed_current_asset_change,
        "original_fcff_cny": original_fcff,
        "partial_fcff_cny": original_fcff - income_after_tax + removed_current_asset_change,
        "fcff_input_status": fcff_status,
        "original_working_capital_cny": metric_value(frame, period, "workingCapital"),
        "partial_working_capital_cny": metric_value(frame, period, "workingCapital") - current["current_assets"],
        "partial_invested_capital_cny": current_capital,
        "partial_average_capital_cny": average_capital,
        "partial_roic": nopat / average_capital if average_capital > 0.0 else np.nan,
        "roic_status": "partial_scope" if average_capital > 0.0 else "nonpositive_average_capital",
        "extra_nonoperating_assets_cny": current["extra_assets"],
        "additional_noncurrent_lease_cny": current["lease"],
        "restricted_cash_minimum_cny": current["restricted_minimum"],
        "source_url": note["sourceUrl"], "note_available_date": note["availableDate"],
        "status": "partial_classification_not_audited", "remaining_gaps": note["scopeGaps"],
    }

classification_method = pd.DataFrame([{
    "method": "annual_notes_only",
    "tax": "group effective tax rate is a simplifying allocation assumption",
    "margin": "subtract initial after-tax financial income / initial revenue from every original target margin; freeze this conversion at review",
    "bridge": "same annual balance date for raw and adjusted comparison; no annual-note carryover into a quarterly bridge",
    "capital": "remove identified extra financial assets; add only noncurrent leases because current leases are already in kernel debt",
    "limits": "partial FCFF still inherits cash-capex, D&A and operating-liability proxies; not fully reconciled operating cash generation",
}])
classification_method`;

export const EQUITY_FCFF_CLASSIFICATION_RECONCILIATION_SOURCE = `initial_classification = annual_classification(valuation_metrics, valuation_base_period, valuation_date)
review_classification = annual_classification(review_metrics, review_base_period, review_date)
classification_reconciliation = pd.DataFrame([initial_classification, review_classification])
classification_reconciliation`;

export const EQUITY_FCFF_CLASSIFICATION_VALUATION_SOURCE = `initial_financial_margin_adjustment = initial_classification["removed_income_after_tax_cny"] / initial_classification["revenue"]
classified_scenarios = valuation_scenarios.copy()
classified_scenarios["target_nopat_margin"] -= initial_financial_margin_adjustment
classification_valuation_rows = []
cutoff_classification_statements = data.equity_financial_statements(valuation_identifier, as_of=market_cutoff_date)
for stage, frame, statements, annual_period, as_of, quote in [
    ("initial", valuation_metrics, valuation_statements, valuation_base_period, valuation_date, initial_quote),
    ("review", review_metrics, review_statements, review_base_period, review_date, review_quote),
    ("cutoff_annual_anchor", cutoff_metrics, cutoff_classification_statements, cutoff_annual_period, market_cutoff_date, cutoff_quote),
]:
    adjustment = annual_classification(frame, annual_period, as_of)
    parent_equity_rows = statements[(statements["report_period"] == annual_period) & (statements["statement_kind"] == "balance_sheet") & (statements["field"] == "totalHldrEqyExcMinInt")]
    if len(parent_equity_rows) != 1 or pd.isna(parent_equity_rows.iloc[0]["value"]):
        raise ValueError("annual_parent_equity_unavailable")
    # IC minus parent equity equals the kernel net-claims formula at this annual date.
    annual_claims = metric_value(frame, annual_period, "investedCapital") - float(parent_equity_rows.iloc[0]["value"])
    annual_claims += operating_cash_required_cny + other_senior_claims_cny - other_non_operating_assets_cny
    annual_shares = metric_value(frame, annual_period, "issuedShares")
    for variant, is_adjusted, reserve_months, asset_haircut in [
        ("raw_annual_anchor", False, 0.0, 0.0),
        ("partial_classification", True, 0.0, 0.0),
        ("partial_with_cash_asset_stress", True, 1.0, 0.10),
    ]:
        cash_reserve = adjustment["restricted_cash_minimum_cny"] + adjustment["revenue"] * reserve_months / 12.0 if is_adjusted else 0.0
        bridge_adjustment = annual_claims
        if is_adjusted:
            bridge_adjustment += adjustment["additional_noncurrent_lease_cny"] + cash_reserve - adjustment["extra_nonoperating_assets_cny"] * (1.0 - asset_haircut)
        base_inputs = pd.DataFrame([{
            "revenue": adjustment["revenue"],
            "nopat_margin": adjustment["partial_nopat_margin"] if is_adjusted else metric_value(frame, annual_period, "nopatMargin"),
        }])
        bridge_inputs = pd.DataFrame([{"bridge_adjustment": bridge_adjustment, "issued_shares": annual_shares, "operating_cash_required": cash_reserve + operating_cash_required_cny}])
        forecast = valuation.fcff_scenarios(base_inputs, classified_scenarios if is_adjusted else valuation_scenarios, bridge_inputs, forecast_years=forecast_years)
        for summary in forecast[scenario_summary_columns].drop_duplicates().to_dict("records"):
            first_year = forecast[(forecast["scenario"] == summary["scenario"]) & (forecast["year"] == 1)].iloc[0]
            classification_valuation_rows.append({
                "stage": stage, "variant": variant, "scenario": summary["scenario"],
                "per_share_value_cny": summary["per_share_value_cny"],
                "observed_close_cny": float(quote["close"]),
                "annual_balance_date": pd.Timestamp(annual_period).strftime("%Y-%m-%d"),
                "quote_date": as_of, "issued_shares": annual_shares,
                "bridge_adjustment_cny": bridge_adjustment,
                "cash_reserve_assumption_cny": cash_reserve,
                "extra_asset_haircut_assumption": asset_haircut,
                "terminal_value_share": summary["terminal_value_share"],
                "next_year_revenue_cny": float(first_year["revenue"]),
                "next_year_nopat_margin": float(first_year["nopat_margin"]),
                "next_year_fcff_cny": float(first_year["fcff"]),
                "status": "annual_anchor_partial_not_current_fair_value",
                "diagnostics": summary["diagnostics"],
            })
classification_valuation = pd.DataFrame(classification_valuation_rows)
classification_valuation`;

export const EQUITY_FCFF_CLASSIFICATION_SOURCES_SOURCE = `classification_source_rows = []
for note in classification_notes:
    for item in note["items"]:
        classification_source_rows.append({
            "identifier": note["identifier"], "report_period": note["period"],
            "item": item["item"], "current_source_units": item["current"],
            "previous_source_units": item["previous"], "source_unit": note["sourceUnit"],
            "pdf_pages": ",".join(str(page) for page in item["pages"]),
            "available_date": note["availableDate"], "source_url": note["sourceUrl"],
            "source_sha256": note["sourceSha256"],
        })
classification_sources = pd.DataFrame(classification_source_rows)
classification_sources`;
