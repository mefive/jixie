from __future__ import annotations

from typing import Any, Literal, TypedDict, overload

from infra.runtime.python.adapter import SdkAdapter

from ...sdk.capabilities import AssetFactorCapabilities, CrossSectionalFactorCapabilities


class CrossSectionalFactorAdapterInput(TypedDict):
    kind: Literal["cross_sectional"]
    history: dict[str, list[Any]] | None


class AssetFactorAdapterInput(TypedDict):
    kind: Literal["asset"]
    fields: dict[str, list[float]]
    index: int
    declared_inputs: set[str]


FactorAdapterInput = CrossSectionalFactorAdapterInput | AssetFactorAdapterInput
FactorCapabilities = CrossSectionalFactorCapabilities | AssetFactorCapabilities


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


class BoundCrossSectionalFactorCapabilities(CrossSectionalFactorCapabilities):
    def __init__(self, history: dict[str, list[Any]] | None) -> None:
        self._history = history

    @property
    def has_history(self) -> bool:
        return self._history is not None

    def history_values(self, field: str) -> list[Any] | None:
        return self._history.get(field) if self._history is not None else None


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
