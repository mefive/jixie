from __future__ import annotations

from typing import Any, Protocol


class ResearchCapabilities(Protocol):
    """Primitives supplied by the execution environment; transport ownership stays in the runtime."""

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        ...
