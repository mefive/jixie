from __future__ import annotations

from typing import Any

from .host import ResearchHost

_FACTOR_WEATHER_COLUMNS = [
    "formation_date",
    "period_end_date",
    "rank_ic",
    "top_return",
    "bottom_return",
    "long_short_gross_return",
    "long_short_net_return",
    "top_turnover",
    "sample_size",
    "sample_coverage",
]


class _ResultsApi:
    def __init__(self, host: ResearchHost, pandas_module: Any) -> None:
        self._host = host
        self._pandas = pandas_module

    def factor_report(self, report_id: str) -> dict[str, Any]:
        result = self._host.request(
            "research_factor_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Factor report response must be an object")
        return result

    def backtest_report(self, report_id: str) -> dict[str, Any]:
        result = self._host.request(
            "research_backtest_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Backtest report response must be an object")
        return result

    def strategy_scan_report(self, report_id: str) -> dict[str, Any]:
        result = self._host.request(
            "research_strategy_scan_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Strategy scan report response must be an object")
        return result

    def factor_weather(self, factor_id: str) -> Any:
        result = self._host.request(
            "research_factor_weather",
            {"factor_id": factor_id},
        )
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=_FACTOR_WEATHER_COLUMNS)
        for column in ("formation_date", "period_end_date"):
            if not frame.empty:
                frame[column] = self._pandas.to_datetime(frame[column], format="%Y%m%d")
        if isinstance(result, dict) and isinstance(result.get("metadata"), dict):
            frame.attrs["jixie"] = result["metadata"]
        return frame
