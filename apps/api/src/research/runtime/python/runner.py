from __future__ import annotations

import ast
import math
import sys
import traceback
from typing import Any, Callable

from ...sdk.python.charts import _ChartsApi
from ...sdk.python.data import _DataApi
from ...sdk.python.results import _ResultsApi
from ...sdk.python.valuation import _ValuationApi
from .analysis import _analyze
from .bridge import _HostBridge
from .environment import _environment, _optional_modules
from .outputs import _figure_numbers, _outputs


def run_research(
    start: dict[str, Any],
    read_frame: Callable[[], dict[str, Any]],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any]], Any],
) -> None:
    if start.get("runtime_version") != "research-py-v1":
        raise ValueError("research runtime requires research-py-v1")
    host = _HostBridge(read_frame, send_frame)
    modules = _optional_modules()
    namespace = _new_namespace(host, modules)
    definitions_by_cell: dict[str, set[str]] = {}
    ready = {"type": "research_ready", "environment": _environment(modules)}
    if "request_capabilities" in start:
        ready["capabilities"] = (
            ["explicit_parameters"]
            if "explicit_parameters" in start["request_capabilities"]
            else []
        )
    send_frame(ready)

    while True:
        message = read_frame()
        message_type = message.get("type")
        if message_type == "close":
            return
        if message_type == "research_reset":
            namespace = _new_namespace(host, modules)
            definitions_by_cell.clear()
            send_frame({"type": "research_reset_done"})
            continue
        if message_type == "research_analyze":
            analyses = []
            for cell in message.get("cells", []):
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
            send_frame({"type": "research_analyzed", "cells": analyses})
            continue
        if message_type != "research_execute":
            raise ValueError(f"unexpected research sandbox message: {message_type}")

        cell_id = str(message.get("cell_id", ""))
        source = str(message.get("source", ""))
        analysis = _analyze(source)
        if analysis.error:
            send_frame(
                {
                    "type": "research_error",
                    "message": analysis.error,
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                }
            )
            continue
        previous_definitions = definitions_by_cell.get(cell_id, set())
        for name in previous_definitions - set(analysis.definitions):
            namespace.pop(name, None)
        try:
            if "parameters" in message:
                parameters = message["parameters"]
                if not isinstance(parameters, dict) or any(
                    not isinstance(key, str)
                    or not (value is None or isinstance(value, (str, int, float, bool)))
                    or (isinstance(value, float) and not math.isfinite(value))
                    for key, value in parameters.items()
                ):
                    raise ValueError("Research parameters must be a dictionary of JSON scalars")
                namespace["parameters"] = dict(parameters)
            figures_before = _figure_numbers(modules.get("matplotlib"))
            value = run_user_code(lambda: _execute(source, namespace))
            sys.stdout.flush()
            sys.stderr.flush()
            outputs = _outputs(value, figures_before, modules)
            definitions_by_cell[cell_id] = set(analysis.definitions)
            send_frame(
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
            send_frame(
                {
                    "type": "research_error",
                    "message": traceback.format_exc(limit=20),
                    "definitions": analysis.definitions,
                    "references": analysis.references,
                }
            )


def _new_namespace(host: _HostBridge, modules: dict[str, Any]) -> dict[str, Any]:
    namespace: dict[str, Any] = {
        "__name__": "__research__",
        "data": _DataApi(host, modules["pandas"]),
        "charts": _ChartsApi(),
        "results": _ResultsApi(host, modules["pandas"]),
        "valuation": _ValuationApi(modules["pandas"]),
    }
    if modules["numpy"] is not None:
        namespace["np"] = modules["numpy"]
    if modules["pandas"] is not None:
        namespace["pd"] = modules["pandas"]
    return namespace


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
