from __future__ import annotations

from typing import Any, Protocol


class CrossSectionalFactorCapabilities(Protocol):
    @property
    def has_history(self) -> bool: ...

    def history_values(self, field: str) -> list[Any] | None: ...


class AssetFactorCapabilities(Protocol):
    def declares_input(self, field: str) -> bool: ...

    def value_at(self, field: str, periods: int) -> Any: ...
