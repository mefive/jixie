from __future__ import annotations

from typing import Any, Literal, TypedDict, overload

from infra.sandbox.python.sdk_adapter import SdkAdapter

from ...sdk.capabilities import AssetFactorCapabilities, CrossSectionalFactorCapabilities


# 绑定截面因子的行情与字段输入，供 Python SDK 读取。
# English: Bind cross-sectional bars and declared fields for Python SDK access.
class CrossSectionalFactorAdapterInput(TypedDict):
    kind: Literal["cross_sectional"]
    history: dict[str, list[Any]] | None


# 绑定资产因子的历史序列与索引，供 Python SDK 读取。
# English: Bind asset histories and indexes for Python SDK access.
class AssetFactorAdapterInput(TypedDict):
    kind: Literal["asset"]
    fields: dict[str, list[float]]
    index: int
    declared_inputs: set[str]


FactorAdapterInput = CrossSectionalFactorAdapterInput | AssetFactorAdapterInput
FactorCapabilities = CrossSectionalFactorCapabilities | AssetFactorCapabilities


# 将宿主输入绑定到 SDK 原始能力，不管理会话生命周期。
# English: Bind host inputs to SDK primitives independently of session lifecycle.
class FactorAdapter(SdkAdapter[FactorAdapterInput, FactorCapabilities]):
    """Bind prepared data to SDK primitives without introducing host requests."""

    @overload
    def bind(self, input: CrossSectionalFactorAdapterInput) -> CrossSectionalFactorCapabilities: ...

    @overload
    def bind(self, input: AssetFactorAdapterInput) -> AssetFactorCapabilities: ...

    @overload
    def bind(self, input: FactorAdapterInput) -> FactorCapabilities: ...

    def bind(self, input: FactorAdapterInput) -> FactorCapabilities:
        if input["kind"] == "cross_sectional":
            return BoundCrossSectionalFactorCapabilities(input["history"])

        return BoundAssetFactorCapabilities(
            input["fields"], input["index"], input["declared_inputs"]
        )


# 只暴露当前截面的已声明字段，供作者代码读取。
# English: Expose declared current cross-section fields to author code.
class BoundCrossSectionalFactorCapabilities(CrossSectionalFactorCapabilities):
    def __init__(self, history: dict[str, list[Any]] | None) -> None:
        self._history = history

    @property
    def has_history(self) -> bool:
        return self._history is not None

    def history_values(self, field: str) -> list[Any] | None:
        return self._history.get(field) if self._history is not None else None


# 提供当前资产的受限历史读取，保留输入绑定的窗口。
# English: Expose bounded asset histories from the current input binding.
class BoundAssetFactorCapabilities(AssetFactorCapabilities):
    def __init__(self, fields: dict[str, list[float]], index: int, declared_inputs: set[str]) -> None:
        self._fields = fields
        self._index = index
        self._declared_inputs = declared_inputs

    def declares_input(self, field: str) -> bool:
        return field in self._declared_inputs

    def value_at(self, field: str, periods: int) -> Any:
        values = self._fields.get(field)
        value_index = self._index - periods
        if values is None or value_index < 0 or value_index >= len(values):
            return None

        return values[value_index]
