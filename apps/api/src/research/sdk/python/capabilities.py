from __future__ import annotations

from typing import Any, Protocol


# 约束研究 SDK 可调用的宿主原始能力，不导入运行器。
# English: Declare Research SDK host primitives independently of the runner.
class ResearchCapabilities(Protocol):
    """Primitives supplied by the execution environment; transport ownership stays in the runtime."""

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        ...
