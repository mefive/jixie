from __future__ import annotations

import math
import sys
import traceback
import types
from collections.abc import Callable
from typing import Any


from ...sdk.python import (
    AssetFactorContext,
    CrossSectionalFactorContext,
    Factor,
    FactorBar,
    _FactorDefinition,
)


def _install_sdk() -> None:
    module = types.ModuleType("jixie")
    module.Factor = Factor
    module.FactorBar = FactorBar
    module.CrossSectionalFactorContext = CrossSectionalFactorContext
    module.AssetFactorContext = AssetFactorContext
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
    if expected_kind == "cross_sectional":
        if factor.window is not None and (
            isinstance(factor.window, bool)
            or not isinstance(factor.window, int)
            or factor.window <= 0
            or factor.window > 505
        ):
            raise ValueError(
                "cross-sectional Factor window must be an integer between 1 and 505"
            )
    else:
        if (
            isinstance(factor.window, bool)
            or not isinstance(factor.window, int)
            or factor.window < 2
            or factor.window > 505
        ):
            raise ValueError("asset Factor window must be an integer between 2 and 505")
        if not factor.inputs or len(set(factor.inputs)) != len(factor.inputs):
            raise ValueError("asset Factor inputs must be a non-empty unique list")
        if not factor.target_asset_classes:
            raise ValueError("asset Factor target_asset_classes must not be empty")
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


def _compute_asset_series(
    factor: _FactorDefinition,
    fields: dict[str, list[float]],
    indexes: list[int],
) -> tuple[list[float | int | None], str | None]:
    values: list[float | int | None] = []
    first_error: str | None = None
    declared_inputs = set(factor.inputs)
    for index in indexes:
        try:
            value = factor._callback(AssetFactorContext(fields, index, declared_inputs))
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
    if expected_kind not in {"cross_sectional", "time_series", "panel"}:
        raise ValueError("unknown Python Factor analysis kind")
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
                "analysis_kind": factor.analysis_kind,
                "inputs": factor.inputs,
                "target_asset_classes": factor.target_asset_classes,
            },
        }
    )

    while True:
        message = read_frame()
        if message.get("type") == "close":
            return
        message_type = message.get("type")
        if factor.analysis_kind == "cross_sectional" and message_type == "factor_compute_batch":
            values, first_error = run_user_code(
                lambda: _compute_cross_sectional_batch(factor, message["items"]),
                "factor batch",
            )
        elif factor.analysis_kind != "cross_sectional" and message_type == "factor_compute_series":
            values, first_error = run_user_code(
                lambda: _compute_asset_series(
                    factor, message["fields"], message["indexes"]
                ),
                "factor series",
            )
        else:
            raise ValueError(f"unexpected factor sandbox message: {message_type}")
        send_frame(
            {
                "type": "factor_values",
                "values": values,
                "first_error": first_error,
            }
        )
