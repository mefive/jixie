from __future__ import annotations

from typing import Any

from .capabilities import ResearchCapabilities


# 读取授权保留报告结果，不重新执行研究计算。
# English: Read authorized retained reports without recomputing them.
class _ResultsApi:
    def __init__(self, capabilities: ResearchCapabilities) -> None:
        self._capabilities = capabilities

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
