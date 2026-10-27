from __future__ import annotations

from typing import Any

from .capabilities import ResearchCapabilities

_EQUITY_DATASET_COLUMNS = [
    "date",
    "code",
    "name",
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

_EQUITY_FUNDAMENTAL_COLUMNS = [
    "announcement_date", "availability_quality", "observed_at",
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
    "as_of_date", "code", "applicability", "statement_kind", "field", "value", "unit",
    "report_period", "available_date", "period_basis", "status", "formula", "formula_version",
    "input_versions_json", "missing_reason",
]

_FINANCIAL_METRIC_COLUMNS = [
    "date",
    "code",
    "name",
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

_EQUITY_DIVIDEND_COLUMNS = [
    "ex_date", "availability_quality", "observed_at",
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


# 公开受控研究数据方法，负责参数转发与 DataFrame 映射。
# English: Expose governed research reads with argument forwarding and DataFrame mapping.
class _DataApi:
    def __init__(self, capabilities: ResearchCapabilities, pandas_module: Any) -> None:
        self._capabilities = capabilities
        self._pandas = pandas_module

    # 请求受控序列并还原带元数据的 DataFrame，保留频率和变换口径。
    # English: Load a governed series into a metadata-bearing DataFrame with frequency and transform conventions.
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
        result = self._capabilities.request(
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

    # 请求历史时点股票截面，保持证券池资格参数。
    # English: Request a dated equity cross-section with explicit eligibility arguments.
    def cross_section(
        self,
        universe: str,
        *,
        date: str,
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._capabilities.request(
            "research_cross_section",
            {
                "universe": universe,
                "date": date,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._equity_frame(result)

    # 请求公开曲线和期限，保留收益率变换与周期政策。
    # English: Request a public curve and tenor with yield transforms and period policy.
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
        result = self._capabilities.request(
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

    # 请求宏观序列并映射 DataFrame，保持可得性与变换元数据。
    # English: Request macro data and map its availability and transform metadata into a DataFrame.
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
        result = self._capabilities.request(
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

    # 请求明确货币对并映射 DataFrame，保留报价与变换口径。
    # English: Request an explicit FX pair and retain quote and transform conventions.
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
        result = self._capabilities.request(
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

    # 请求已完成月末股票 Panel，保持资格及频率约束。
    # English: Request a completed-month-end equity panel with explicit eligibility and frequency.
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
        result = self._capabilities.request(
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
        result = self._capabilities.request(
            "research_commodity_returns",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_RETURN_COLUMNS)

    def commodity_warehouse_receipts(self, product: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_commodity_warehouse_receipts",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_WAREHOUSE_RECEIPT_COLUMNS)

    def commodity_holdings(self, product: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_commodity_holdings",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_HOLDING_COLUMNS)

    def equity_fundamentals(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_equity_fundamentals",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(
            result, _EQUITY_FUNDAMENTAL_COLUMNS, ["date", "announcement_date", "report_period"]
        )

    def equity_financial_values(
        self, identifiers: str | list[str], *, as_of: str, fields: str | list[str],
        report_start: str, report_end: str, period: str = "reported",
    ) -> Any:
        result = self._capabilities.request("research_equity_financial_values", {
            "identifiers": identifiers, "as_of": as_of, "fields": fields,
            "report_start": report_start, "report_end": report_end, "period": period,
        })
        return self._dataset_frame(result, _FINANCIAL_VALUE_COLUMNS, ["as_of_date", "report_period", "available_date"])

    # 读取单证券历史可见财报，规范化字段及报告期请求。
    # English: Load as-of statements for one instrument with normalized field and reporting bounds.
    def equity_financial_statements(
        self, identifier: str, *, as_of: str, fields: str | list[str] | None = None,
        report_start: str | None = None, report_end: str | None = None,
    ) -> Any:
        filters = {key: value for key, value in {
            "fields": fields, "report_start": report_start, "report_end": report_end,
        }.items() if value is not None}
        result = self._capabilities.request(
            "research_equity_financial_statements",
            {"identifier": identifier, "as_of": as_of, **filters},
        )
        return self._dataset_frame(
            result,
            _FINANCIAL_STATEMENT_COLUMNS,
            ["as_of_date", "report_period", "announcement_date", "available_date"],
        )

    def equity_financial_metrics(self, identifier: str, *, as_of: str) -> Any:
        result = self._capabilities.request(
            "research_equity_financial_metrics",
            {"identifier": identifier, "as_of": as_of},
        )
        return self._dataset_frame(
            result, _FINANCIAL_METRIC_COLUMNS, ["date", "report_period"]
        )

    # 请求有界股票财务截面并规范化所选指标。
    # English: Request bounded equity financial cross-sections with normalized metric selections.
    def equity_financial_cross_section(
        self,
        universe: str,
        *,
        date: str,
        metrics: str | list[str],
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._capabilities.request(
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

    # 读取有界历史月末财务 Panel，规范化指标参数。
    # English: Load a bounded historical month-end financial panel with normalized metric arguments.
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
        result = self._capabilities.request(
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

    def equity_dividends(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_equity_dividends",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(
            result, _EQUITY_DIVIDEND_COLUMNS, ["date", "ex_date", "report_period"]
        )

    def etf_shares(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_etf_shares",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _ETF_SHARE_COLUMNS, ["date", "trade_date"])

    def index_valuation(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_index_valuation",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _INDEX_VALUATION_COLUMNS, ["date"])

    def futures_settlement(self, identifier: str, *, start: str, end: str) -> Any:
        result = self._capabilities.request(
            "research_futures_settlement",
            {"identifier": identifier, "start": start, "end": end},
        )
        return self._dataset_frame(result, _FUTURES_SETTLEMENT_COLUMNS, ["date"])

    # 将股票数据响应转成 DataFrame 并附加覆盖元数据。
    # English: Map equity responses into DataFrames with coverage metadata.
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

    # 将序列响应转成 DataFrame 并保留单位与来源。
    # English: Map series responses into DataFrames with units and provenance.
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

    # 将通用数据集响应转成 DataFrame 并保留公开元数据。
    # English: Map dataset responses into DataFrames while retaining public metadata.
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
