from __future__ import annotations

from typing import Any

from .host import ResearchHost

_EQUITY_DATASET_COLUMNS = [
    "date",
    "code",
    "name",
    "industry",
    "close",
    "adjusted_close",
    "daily_return_pct",
    "volume_lot",
    "amount_cny_1k",
    "pe",
    "pe_ttm",
    "pb",
    "ps",
    "dividend_yield_pct",
    "total_market_cap_cny_10k",
    "float_market_cap_cny_10k",
    "turnover_rate_pct",
]

_COMMODITY_RETURN_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "continuous_code",
    "mapped_contract",
    "continuous_return",
    "continuous_log_return",
    "mapped_log_return",
    "roll_gap_log_return",
    "roll_yield_proxy",
    "mapping_changed",
]

_COMMODITY_WAREHOUSE_RECEIPT_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "unit",
    "volume",
    "volume_change",
    "unit_correction_applied",
]

_COMMODITY_HOLDING_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "reference_contract",
    "contract_open_interest",
    "contract_volume",
    "ranked_volume",
    "ranked_volume_change",
    "ranked_long_holding",
    "ranked_long_change",
    "ranked_short_holding",
    "ranked_short_change",
    "top_five_long_holding",
    "top_five_short_holding",
    "volume_member_count",
    "long_member_count",
    "short_member_count",
    "source_correction_applied",
]

_MARKET_STATE_COLUMNS = [
    "date",
    "activity",
    "breadth",
    "trend",
    "crowding",
    "advance_ratio",
    "above_ma20_ratio",
    "above_ma60_ratio",
    "total_amount_cny_1k",
    "extreme_move_ratio",
    "limit_up_count",
    "limit_down_count",
    "traded_count",
]

_EQUITY_FUNDAMENTAL_COLUMNS = [
    "date",
    "report_period",
    "roe_pct",
    "roe_waa_pct",
    "roa_pct",
    "gross_profit_margin_pct",
    "net_profit_margin_pct",
    "debt_to_assets_pct",
    "revenue_yoy_pct",
    "net_profit_yoy_pct",
    "operating_cash_flow_to_profit",
]

_FINANCIAL_STATEMENT_COLUMNS = [
    "as_of_date",
    "code",
    "industry",
    "applicability",
    "report_period",
    "statement_kind",
    "field",
    "value",
    "unit",
    "announcement_date",
    "available_date",
    "availability_quality",
    "report_type",
    "source_row_fingerprint",
]

_FINANCIAL_VALUE_COLUMNS = [
    "as_of_date", "code", "industry", "applicability", "statement_kind", "field", "value", "unit",
    "report_period", "available_date", "period_basis", "status", "formula", "formula_version",
    "input_versions_json", "missing_reason",
]

_FINANCIAL_METRIC_COLUMNS = [
    "date",
    "code",
    "name",
    "industry",
    "applicability",
    "report_period",
    "metric",
    "value",
    "unit",
    "status",
    "missing_reason",
    "formula",
    "formula_version",
    "input_versions_json",
]

_EQUITY_FLOW_COLUMNS = [
    "date",
    "net_main_cny_10k",
    "net_total_cny_10k",
    "dragon_tiger_net_cny",
]

_EQUITY_DIVIDEND_COLUMNS = [
    "date",
    "report_period",
    "announcement_date",
    "cash_dividend_pre_tax",
    "cash_dividend_tax_basis",
]

_ETF_SHARE_COLUMNS = [
    "date",
    "trade_date",
    "total_share_10k",
    "total_size_cny_10k",
    "nav",
    "close",
    "exchange",
]

_INDEX_VALUATION_COLUMNS = [
    "date",
    "total_mv_cny",
    "float_mv_cny",
    "total_share",
    "float_share",
    "free_share",
    "turnover_rate_pct",
    "turnover_rate_free_float_pct",
    "pe",
    "pe_ttm",
    "pb",
]

_INDUSTRY_STATE_COLUMNS = [
    "date",
    "industry_code",
    "industry_name",
    "traded_count",
    "return_20d",
    "excess_return_20d",
    "positive_return_20d_ratio",
    "above_ma20_ratio",
    "above_ma60_ratio",
    "float_weighted_turnover_rate_pct",
    "amount_share",
    "top_five_amount_share",
]

_FUTURES_SETTLEMENT_COLUMNS = [
    "date",
    "settle",
    "trading_fee_rate",
    "trading_fee",
    "delivery_fee",
    "buy_hedge_margin_rate_pct",
    "sell_hedge_margin_rate_pct",
    "long_margin_rate_pct",
    "short_margin_rate_pct",
    "close_today_fee",
    "exchange",
]


class _DataApi:
    def __init__(self, host: ResearchHost, pandas_module: Any) -> None:
        self._host = host
        self._pandas = pandas_module

    def series(
        self,
        asset_type: str,
        identifier: str,
        *,
        start: str,
        end: str,
        measure: str = "market.adjusted_close",
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_series",
            {
                "asset_type": asset_type,
                "identifier": identifier,
                "start": start,
                "end": end,
                "measure": measure,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def cross_section(
        self,
        universe: str,
        *,
        date: str,
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_cross_section",
            {
                "universe": universe,
                "date": date,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._equity_frame(result)

    def yield_curve(
        self,
        curve: str,
        *,
        tenor: str,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_yield_curve",
            {
                "curve": curve,
                "tenor": tenor,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def macro(
        self,
        series: str,
        *,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_macro",
            {
                "series": series,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def fx(
        self,
        pair: str,
        *,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_fx",
            {
                "pair": pair,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def panel(
        self,
        universe: str,
        *,
        start: str,
        end: str,
        frequency: str = "month_end",
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_panel",
            {
                "universe": universe,
                "start": start,
                "end": end,
                "frequency": frequency,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._equity_frame(result)

    def commodity_returns(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_returns",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_RETURN_COLUMNS)

    def commodity_warehouse_receipts(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_warehouse_receipts",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_WAREHOUSE_RECEIPT_COLUMNS)

    def commodity_holdings(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_holdings",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_HOLDING_COLUMNS)

    def market_state(self, scope: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_market_state",
            {"scope": scope, "start": start, "end": end},
        )
        return self._dataset_frame(result, _MARKET_STATE_COLUMNS, ["date"])

    def equity_fundamentals(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_equity_fundamentals",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(
            result, _EQUITY_FUNDAMENTAL_COLUMNS, ["date", "report_period"]
        )

    def equity_financial_values(
        self, identifiers: str | list[str], *, as_of: str, fields: str | list[str],
        report_start: str, report_end: str, period: str = "reported",
    ) -> Any:
        result = self._host.request("research_equity_financial_values", {
            "identifiers": identifiers, "as_of": as_of, "fields": fields,
            "report_start": report_start, "report_end": report_end, "period": period,
        })
        return self._dataset_frame(result, _FINANCIAL_VALUE_COLUMNS, ["as_of_date", "report_period", "available_date"])

    def equity_financial_statements(
        self, identifier: str, *, as_of: str, fields: str | list[str] | None = None,
        report_start: str | None = None, report_end: str | None = None,
    ) -> Any:
        filters = {key: value for key, value in {
            "fields": fields, "report_start": report_start, "report_end": report_end,
        }.items() if value is not None}
        result = self._host.request(
            "research_equity_financial_statements",
            {"identifier": identifier, "as_of": as_of, **filters},
        )
        return self._dataset_frame(
            result,
            _FINANCIAL_STATEMENT_COLUMNS,
            ["as_of_date", "report_period", "announcement_date", "available_date"],
        )

    def equity_financial_metrics(self, identifier: str, *, as_of: str) -> Any:
        result = self._host.request(
            "research_equity_financial_metrics",
            {"identifier": identifier, "as_of": as_of},
        )
        return self._dataset_frame(
            result, _FINANCIAL_METRIC_COLUMNS, ["date", "report_period"]
        )

    def equity_financial_cross_section(
        self,
        universe: str,
        *,
        date: str,
        metrics: str | list[str],
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_equity_financial_cross_section",
            {
                "universe": universe,
                "date": date,
                "metrics": metrics,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._dataset_frame(
            result, _FINANCIAL_METRIC_COLUMNS, ["date", "report_period"]
        )

    def equity_financial_panel(
        self,
        universe: str,
        *,
        start: str,
        end: str,
        frequency: str = "month_end",
        metrics: str | list[str],
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_equity_financial_panel",
            {
                "universe": universe,
                "start": start,
                "end": end,
                "frequency": frequency,
                "metrics": metrics,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._dataset_frame(
            result, _FINANCIAL_METRIC_COLUMNS, ["date", "report_period"]
        )

    def equity_flows(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_equity_flows",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _EQUITY_FLOW_COLUMNS, ["date"])

    def equity_dividends(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_equity_dividends",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(
            result, _EQUITY_DIVIDEND_COLUMNS, ["date", "report_period"]
        )

    def etf_shares(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_etf_shares",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _ETF_SHARE_COLUMNS, ["date", "trade_date"])

    def index_valuation(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_index_valuation",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _INDEX_VALUATION_COLUMNS, ["date"])

    def industry_state(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_industry_state",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _INDUSTRY_STATE_COLUMNS, ["date"])

    def futures_settlement(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_futures_settlement",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _FUTURES_SETTLEMENT_COLUMNS, ["date"])

    def _equity_frame(self, result: Any) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=_EQUITY_DATASET_COLUMNS)
        if not frame.empty:
            frame["date"] = self._pandas.to_datetime(frame["date"], format="%Y%m%d")
        if isinstance(result, dict) and isinstance(result.get("metadata"), dict):
            frame.attrs["jixie"] = result["metadata"]
        return frame

    def _series_frame(self, result: Any) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=["date", "value"])
        if not frame.empty:
            frame["date"] = self._pandas.to_datetime(frame["date"], format="%Y%m%d")
        if isinstance(result, dict) and isinstance(result.get("diagnostics"), list):
            frame.attrs["jixie"] = {"diagnostics": result["diagnostics"]}
        return frame

    def _dataset_frame(
        self, result: Any, columns: list[str], date_columns: list[str] | None = None
    ) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=columns)
        for column in date_columns or ["date", "trade_date"]:
            if not frame.empty:
                frame[column] = self._pandas.to_datetime(frame[column], format="%Y%m%d")
        return frame
