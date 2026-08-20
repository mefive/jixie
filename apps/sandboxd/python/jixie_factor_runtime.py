from __future__ import annotations

import math
import sys
import traceback
import types
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


def _install_sdk() -> None:
    module = types.ModuleType("jixie")
    module.Factor = Factor
    module.FactorBar = FactorBar
    module.CrossSectionalFactorContext = CrossSectionalFactorContext
    sys.modules["jixie"] = module


def _load_factor(source: str, expected_kind: str) -> _FactorDefinition:
    _install_sdk()
    namespace: dict[str, Any] = {"__name__": "__factor__"}
    exec(compile(source, "factor.py", "exec"), namespace, namespace)
    factor = namespace.get("factor")
    if not isinstance(factor, _FactorDefinition) or factor._callback is None:
        raise TypeError(
            "factor.py must define `factor = Factor.<analysis_kind>(...)` and one @factor.compute callback"
        )
    if factor.analysis_kind != expected_kind:
        raise ValueError(
            f"Factor factory {factor.analysis_kind} does not match {expected_kind}"
        )
    if not isinstance(factor.name, str) or not factor.name.strip():
        raise ValueError("Factor name must be a non-empty string")
    if factor.window is not None and (
        isinstance(factor.window, bool)
        or not isinstance(factor.window, int)
        or factor.window <= 0
        or factor.window > 505
    ):
        raise ValueError("cross-sectional Factor window must be an integer between 1 and 505")
    if factor.min_coverage is not None and (
        isinstance(factor.min_coverage, bool)
        or not isinstance(factor.min_coverage, (int, float))
        or not math.isfinite(factor.min_coverage)
        or factor.min_coverage < 0.1
        or factor.min_coverage > 1
    ):
        raise ValueError("Factor min_coverage must be between 0.1 and 1")
    return factor


def _compute_cross_sectional_batch(
    factor: _FactorDefinition, items: list[dict[str, Any]]
) -> tuple[list[float | int | None], str | None]:
    values: list[float | int | None] = []
    first_error: str | None = None
    for item in items:
        try:
            value = factor._callback(
                FactorBar(item["bar"]),
                CrossSectionalFactorContext(item.get("history")),
            )
            values.append(
                value
                if isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                else None
            )
        except Exception:
            if first_error is None:
                first_error = traceback.format_exc(limit=20)
            values.append(None)
    return values, first_error


def run_factor(
    start: dict[str, Any],
    read_frame: Callable[[], dict[str, Any]],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any], str], Any],
) -> None:
    if start.get("runtime_version") != "py-v1":
        raise ValueError("factor sandbox requires runtime py-v1")
    expected_kind = start.get("analysis_kind")
    if expected_kind != "cross_sectional":
        raise ValueError("this runtime currently supports cross_sectional Python Factors")
    factor = run_user_code(
        lambda: _load_factor(start["code"], expected_kind), "factor initialization"
    )
    send_frame(
        {
            "type": "factor_ready",
            "metadata": {
                "name": factor.name,
                "window": factor.window,
                "min_coverage": factor.min_coverage,
            },
        }
    )

    while True:
        message = read_frame()
        if message.get("type") == "close":
            return
        if message.get("type") != "factor_compute_batch":
            raise ValueError(f"unexpected factor sandbox message: {message.get('type')}")
        values, first_error = run_user_code(
            lambda: _compute_cross_sectional_batch(factor, message["items"]),
            "factor batch",
        )
        send_frame(
            {
                "type": "factor_values",
                "values": values,
                "first_error": first_error,
            }
        )
