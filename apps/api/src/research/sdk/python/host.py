from __future__ import annotations

from typing import Any, Protocol


class ResearchHost(Protocol):
    """Injected data access; transport and session ownership stay in the runtime."""

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        ...
