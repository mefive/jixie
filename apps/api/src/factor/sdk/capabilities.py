from __future__ import annotations

from typing import Any, Protocol


# 声明截面作者 SDK 所需原始字段能力，避免导入 runtime。
# English: Declare primitive cross-sectional SDK capabilities independently of runtime.
class CrossSectionalFactorCapabilities(Protocol):
    @property
    def has_history(self) -> bool: ...

    def history_values(self, field: str) -> list[Any] | None: ...


# 声明资产作者 SDK 所需历史能力，避免导入 runtime。
# English: Declare primitive asset SDK histories independently of runtime.
class AssetFactorCapabilities(Protocol):
    def declares_input(self, field: str) -> bool: ...

    def value_at(self, field: str, periods: int) -> Any: ...
