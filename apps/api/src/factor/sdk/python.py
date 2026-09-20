from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any


class _AttrDict(dict[str, Any]):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error


class FactorBar(_AttrDict):
    pass


class CrossSectionalFactorContext:
    def __init__(self, history: dict[str, list[Any]] | None) -> None:
        self._history = history

    def history(self, periods: int, field: str = "close") -> list[Any]:
        if self._history is None:
            raise RuntimeError(
                "Factor must declare window before using ctx.history(periods, field)"
            )
        if isinstance(periods, bool) or not isinstance(periods, int) or periods <= 0:
            raise ValueError("history periods must be a positive integer")
        values = self._history.get(field)
        if values is None:
            raise ValueError(f"unsupported Factor history field: {field}")
        if len(values) < periods:
            return []
        return values[-periods:]


class AssetFactorContext:
    def __init__(
        self, fields: dict[str, list[float]], index: int, declared_inputs: set[str]
    ) -> None:
        self._fields = fields
        self._index = index
        self._declared_inputs = declared_inputs

    def value(self, field: str) -> float | None:
        return self.lag(field, 0)

    def lag(self, field: str, periods: int) -> float | None:
        if field not in self._declared_inputs:
            raise ValueError(f"Factor code accessed undeclared input {field}")
        if isinstance(periods, bool) or not isinstance(periods, int) or periods < 0:
            raise ValueError("ctx.lag periods must be a non-negative integer")
        values = self._fields.get(field)
        value_index = self._index - periods
        if values is None or value_index < 0 or value_index >= len(values):
            return None
        value = values[value_index]
        return value if isinstance(value, (int, float)) and math.isfinite(value) else None


class _FactorDefinition:
    def __init__(
        self,
        analysis_kind: str,
        *,
        name: str,
        window: int | None = None,
        min_coverage: float | None = None,
        inputs: list[str] | None = None,
        target_asset_classes: list[str] | None = None,
    ) -> None:
        self.analysis_kind = analysis_kind
        self.name = name
        self.window = window
        self.min_coverage = min_coverage
        self.inputs = list(inputs or [])
        self.target_asset_classes = list(target_asset_classes or [])
        self._callback: Callable[..., float | int | None] | None = None

    def compute(self, callback: Callable[..., float | int | None]) -> Callable[..., float | int | None]:
        if self._callback is not None:
            raise ValueError("Factor supports exactly one @factor.compute callback")
        self._callback = callback
        return callback


class Factor:
    @classmethod
    def cross_sectional(
        cls,
        *,
        name: str,
        window: int | None = None,
        min_coverage: float | None = None,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "cross_sectional",
            name=name,
            window=window,
            min_coverage=min_coverage,
        )

    @classmethod
    def time_series(
        cls,
        *,
        name: str,
        inputs: list[str],
        target_asset_classes: list[str],
        window: int,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "time_series",
            name=name,
            window=window,
            inputs=inputs,
            target_asset_classes=target_asset_classes,
        )

    @classmethod
    def panel(
        cls,
        *,
        name: str,
        inputs: list[str],
        target_asset_classes: list[str],
        window: int,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "panel",
            name=name,
            window=window,
            inputs=inputs,
            target_asset_classes=target_asset_classes,
        )
