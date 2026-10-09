from __future__ import annotations

import ast
import math
import sys
import traceback
from typing import Any, Callable

from ...sdk.python.bindings import create_research_sdk
from .analysis import _analyze
from .adapter import ResearchAdapter, ResearchAdapterInput
from .environment import _environment, _optional_modules
from .outputs import _figure_numbers, _outputs


class ResearchRunner:
    """One instance owns one sandbox session and all state shared across its cells."""

    def __init__(
        self,
        read_frame: Callable[[], dict[str, Any]],
        send_frame: Callable[[dict[str, Any]], None],
        run_user_code: Callable[[Callable[[], Any]], Any],
    ) -> None:
        self._send_frame = send_frame
        self._run_user_code = run_user_code
        self._adapter = ResearchAdapter()
        self._adapter_input: ResearchAdapterInput = {
            "read_frame": read_frame,
            "send_frame": send_frame,
        }
        self._modules: dict[str, Any]
        self._namespace: dict[str, Any]
        self._definitions_by_cell: dict[str, set[str]] = {}

    def handle(self, frame: dict[str, Any]) -> bool:
        match frame.get("type"):
            case "research_execute":
                self._execute(frame)
                return True
            case "research_analyze":
                self._analyze(frame.get("cells", []))
                return True
            case "research_reset":
                self._reset()
                return True
            case "close":
                return False
            case _:
                raise ValueError(f"unexpected research sandbox message: {frame.get('type')}")

    def start(self, config: dict[str, Any]) -> None:
        if config.get("runtime_version") != "research-py-v1":
            raise ValueError("research runtime requires research-py-v1")
        self._modules = _optional_modules()
        self._namespace = self._new_namespace()
        ready = {"type": "research_ready", "environment": _environment(self._modules)}
        if "request_capabilities" in config:
            ready["capabilities"] = (
                ["explicit_parameters"]
                if "explicit_parameters" in config["request_capabilities"]
                else []
            )

        self._send_frame(ready)

    def _execute(self, frame: dict[str, Any]) -> None:
        cell_id = str(frame.get("cell_id", ""))
        source = str(frame.get("source", ""))
        analysis = _analyze(source)
        if analysis.error:
            self._send_frame(
                {
                    "type": "research_error",
                    "message": analysis.error,
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                }
            )
            return
        previous_definitions = self._definitions_by_cell.get(cell_id, set())
        for name in previous_definitions - set(analysis.definitions):
            self._namespace.pop(name, None)
        try:
            if "parameters" in frame:
                parameters = frame["parameters"]
                if not isinstance(parameters, dict) or any(
                    not isinstance(key, str)
                    or not (value is None or isinstance(value, (str, int, float, bool)))
                    or (isinstance(value, float) and not math.isfinite(value))
                    for key, value in parameters.items()
                ):
                    raise ValueError("Research parameters must be a dictionary of JSON scalars")
                self._namespace["parameters"] = dict(parameters)
            figures_before = _figure_numbers(self._modules.get("matplotlib"))
            value = self._run_user_code(lambda: _execute(source, self._namespace))
            sys.stdout.flush()
            sys.stderr.flush()
            outputs = _outputs(value, figures_before, self._modules)
            self._definitions_by_cell[cell_id] = set(analysis.definitions)
            self._send_frame(
                {
                    "type": "research_executed",
                    "outputs": outputs,
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                }
            )
        except Exception:
            sys.stdout.flush()
            sys.stderr.flush()
            self._send_frame(
                {
                    "type": "research_error",
                    "message": traceback.format_exc(limit=20),
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                }
            )

    def _new_namespace(self) -> dict[str, Any]:
        capabilities = self._adapter.bind(self._adapter_input)

        namespace: dict[str, Any] = {
            "__name__": "__research__",
            **create_research_sdk(capabilities, self._modules["pandas"]),
        }
        if self._modules["numpy"] is not None:
            namespace["np"] = self._modules["numpy"]
        if self._modules["pandas"] is not None:
            namespace["pd"] = self._modules["pandas"]

        return namespace

    def _analyze(self, cells: list[dict[str, Any]]) -> None:
        analyses = []
        for cell in cells:
            analysis = _analyze(str(cell.get("source", "")))
            analyses.append(
                {
                    "cell_id": cell.get("id"),
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                    "imports": analysis.imports,
                    "series_requests": analysis.series_requests,
                    "yield_curve_requests": analysis.yield_curve_requests,
                    "macro_requests": analysis.macro_requests,
                    "fx_requests": analysis.fx_requests,
                    "commodity_requests": analysis.commodity_requests,
                    "equity_requests": analysis.equity_requests,
                    **({"error": analysis.error} if analysis.error else {}),
                }
            )

        self._send_frame({"type": "research_analyzed", "cells": analyses})

    def _reset(self) -> None:
        self._namespace = self._new_namespace()
        self._definitions_by_cell.clear()

        self._send_frame({"type": "research_reset_done"})


def run_research(
    start: dict[str, Any],
    receive_commands: Callable[[Callable[[dict[str, Any]], bool]], None],
    read_frame: Callable[[], dict[str, Any]],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any]], Any],
) -> None:
    runner = ResearchRunner(read_frame, send_frame, run_user_code)
    runner.start(start)

    receive_commands(runner.handle)


def _execute(source: str, namespace: dict[str, Any]) -> Any:
    tree = ast.parse(source or "pass", filename="research_cell.py", mode="exec")
    if not tree.body or not isinstance(tree.body[-1], ast.Expr):
        exec(compile(tree, "research_cell.py", "exec"), namespace, namespace)
        return None
    statements = ast.Module(body=tree.body[:-1], type_ignores=[])
    expression = ast.Expression(body=tree.body[-1].value)
    if statements.body:
        exec(compile(statements, "research_cell.py", "exec"), namespace, namespace)
    return eval(compile(expression, "research_cell.py", "eval"), namespace, namespace)
