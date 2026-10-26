from __future__ import annotations

from typing import Any

from .capabilities import ResearchCapabilities
from .charts import _ChartsApi
from .data import _DataApi
from .results import _ResultsApi
from .valuation import _ValuationApi


# 由注入原始能力构造 data、results、valuation 和 charts 作者对象。
# English: Construct data, results, valuation and charts objects from injected primitives.
def create_research_sdk(capabilities: ResearchCapabilities, pandas_module: Any) -> dict[str, Any]:
    """Bind public author objects without owning namespace or execution state."""
    return {
        "data": _DataApi(capabilities, pandas_module),
        "charts": _ChartsApi(),
        "results": _ResultsApi(capabilities),
        "valuation": _ValuationApi(pandas_module),
    }
