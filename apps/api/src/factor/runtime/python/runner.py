from __future__ import annotations

import math
import sys
import traceback
import types
from collections.abc import Callable
from typing import Any, cast

from ...sdk.python import (
    AssetFactorContext,
    CrossSectionalFactorContext,
    Factor,
    FactorBar,
    _FactorDefinition,
)


class FactorRunner:
    """One instance owns one sandbox session and all state shared across its callbacks."""

    def __init__(
        self,
        send_frame: Callable[[dict[str, Any]], None],
        run_user_code: Callable[[Callable[[], Any], str], Any],
    ) -> None:
        self._send_frame = send_frame
        self._run_user_code = run_user_code
        self._factor: _FactorDefinition

    def handle(self, frame: dict[str, Any]) -> bool:
        message_type = frame.get("type")

        match message_type:
            case "factor_compute_batch":
                if self._factor.analysis_kind != "cross_sectional":
                    raise ValueError(f"unexpected factor sandbox message: {message_type}")

                self._execute(frame)
                return True
            case "factor_compute_series":
                if self._factor.analysis_kind == "cross_sectional":
                    raise ValueError(f"unexpected factor sandbox message: {message_type}")

                self._execute(frame)
                return True
            case "close":
                return False
            case _:
                raise ValueError(f"unexpected factor sandbox message: {message_type}")

    def start(self, config: dict[str, Any]) -> None:
        if config.get("runtime_version") != "py-v1":
            raise ValueError("factor sandbox requires runtime py-v1")
        expected_kind = config.get("analysis_kind")
        if expected_kind not in {"cross_sectional", "time_series", "panel"}:
            raise ValueError("unknown Python Factor analysis kind")

        self._factor = self._run_user_code(
            lambda: self._load_factor(config["code"], expected_kind),
            "factor initialization",
        )

        self._send_frame({"type": "factor_ready", "metadata": self._metadata()})

    def _execute(self, frame: dict[str, Any]) -> None:
        def compute() -> tuple[list[float | int | None], str | None]:
            # Startup validates that the author registered a callback.
            callback = cast(Callable[..., float | int | None], self._factor._callback)
            if frame["type"] == "factor_compute_batch":
                items = frame["items"]

                return self._compute_values(
                    len(items),
                    lambda index: callback(
                        FactorBar(items[index]["bar"]),
                        CrossSectionalFactorContext(items[index].get("history")),
                    ),
                )

            fields = frame["fields"]
            indexes = frame["indexes"]

            # Preserve Python's per-batch declaration snapshot inside the user-code budget.
            declared_inputs = set(self._factor.inputs)

            return self._compute_values(
                len(indexes),
                lambda position: callback(
                    AssetFactorContext(fields, indexes[position], declared_inputs)
                ),
            )

        values, first_error = self._run_user_code(
            compute,
            "factor batch" if frame["type"] == "factor_compute_batch" else "factor series",
        )

        self._send_frame(
            {"type": "factor_values", "values": values, "first_error": first_error}
        )

    def _load_factor(self, source: str, expected_kind: str) -> _FactorDefinition:
        module = types.ModuleType("jixie")
        module.__dict__.update(
            Factor=Factor,
            FactorBar=FactorBar,
            CrossSectionalFactorContext=CrossSectionalFactorContext,
            AssetFactorContext=AssetFactorContext,
        )
        sys.modules["jixie"] = module

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

    def _metadata(self) -> dict[str, Any]:
        return {
            "name": self._factor.name,
            "window": self._factor.window,
            "min_coverage": self._factor.min_coverage,
            "analysis_kind": self._factor.analysis_kind,
            "inputs": self._factor.inputs,
            "target_asset_classes": self._factor.target_asset_classes,
        }

    def _compute_values(
        self,
        count: int,
        callback: Callable[[int], float | int | None],
    ) -> tuple[list[float | int | None], str | None]:
        values: list[float | int | None] = []
        first_error: str | None = None
        for index in range(count):
            try:
                value = callback(index)
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
    receive_commands: Callable[[Callable[[dict[str, Any]], bool]], None],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any], str], Any],
) -> None:
    runner = FactorRunner(send_frame, run_user_code)
    runner.start(start)

    receive_commands(runner.handle)
