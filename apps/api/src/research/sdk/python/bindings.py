from __future__ import annotations

from typing import Any

from .capabilities import ResearchCapabilities
from .charts import _ChartsApi
from .data import _DataApi
from .results import _ResultsApi
from .valuation import _ValuationApi


def create_research_sdk(capabilities: ResearchCapabilities, pandas_module: Any) -> dict[str, Any]:
    """Bind public author objects without owning namespace or execution state."""
    return {
        "data": _DataApi(capabilities, pandas_module),
        "charts": _ChartsApi(),
        "results": _ResultsApi(capabilities, pandas_module),
        "valuation": _ValuationApi(pandas_module),
    }
