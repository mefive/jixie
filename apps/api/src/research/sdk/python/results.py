from __future__ import annotations

from typing import Any

from .capabilities import ResearchCapabilities

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


# 读取授权冻结报告与气象结果，不重新执行研究计算。
# English: Read authorized frozen reports and weather results without recomputing them.
class _ResultsApi:
    def __init__(self, capabilities: ResearchCapabilities, pandas_module: Any) -> None:
        self._capabilities = capabilities
        self._pandas = pandas_module

    def factor_report(self, report_id: str) -> dict[str, Any]:
        result = self._capabilities.request(
            "research_factor_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Factor report response must be an object")
        return result

    def backtest_report(self, report_id: str) -> dict[str, Any]:
        result = self._capabilities.request(
            "research_backtest_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Backtest report response must be an object")
        return result

    def strategy_scan_report(self, report_id: str) -> dict[str, Any]:
        result = self._capabilities.request(
            "research_strategy_scan_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Strategy scan report response must be an object")
        return result

    # 按因子身份读取气象结果并整理可供 Python 使用的数据。
    # English: Read factor-weather results by identity and map them for Python use.
    def factor_weather(self, factor_id: str) -> Any:
        result = self._capabilities.request(
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
