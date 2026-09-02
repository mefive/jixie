from __future__ import annotations

import ast
import base64
import builtins
import io
import json
import math
import platform
import signal
import sys
import traceback
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Callable


_MAX_TABLE_ROWS = 200
_MAX_TABLE_COLUMNS = 64
_MAX_TABLE_CELL_CHARACTERS = 256
_MAX_TABLE_PREVIEW_BYTES = 1 * 1024 * 1024
_MAX_CHART_ROWS = 5_000
_MAX_CHART_SERIES = 20
_MAX_IMAGE_BYTES = 4 * 1024 * 1024
_RUNTIME_NAMES = {"charts", "data", "np", "pd", "results"}
_EQUITY_DATASET_COLUMNS = [
    "date",
    "code",
    "name",
    "industry",
    "close",
    "adjusted_close",
    "daily_return_pct",
    "volume_lot",
    "amount_cny_1k",
    "pe",
    "pe_ttm",
    "pb",
    "ps",
    "dividend_yield_pct",
    "total_market_cap_cny_10k",
    "float_market_cap_cny_10k",
    "turnover_rate_pct",
]
_COMMODITY_RETURN_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "continuous_code",
    "mapped_contract",
    "continuous_return",
    "continuous_log_return",
    "mapped_log_return",
    "roll_gap_log_return",
    "roll_yield_proxy",
    "mapping_changed",
]
_COMMODITY_WAREHOUSE_RECEIPT_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "unit",
    "volume",
    "volume_change",
    "unit_correction_applied",
]
_COMMODITY_HOLDING_COLUMNS = [
    "date",
    "trade_date",
    "product",
    "reference_contract",
    "contract_open_interest",
    "contract_volume",
    "ranked_volume",
    "ranked_volume_change",
    "ranked_long_holding",
    "ranked_long_change",
    "ranked_short_holding",
    "ranked_short_change",
    "top_five_long_holding",
    "top_five_short_holding",
    "volume_member_count",
    "long_member_count",
    "short_member_count",
    "source_correction_applied",
]


@dataclass
class _Analysis:
    definitions: list[str]
    references: list[str]
    imports: list[str]
    series_requests: list[dict[str, Any]]
    yield_curve_requests: list[dict[str, Any]]
    macro_requests: list[dict[str, Any]]
    fx_requests: list[dict[str, Any]]
    commodity_requests: list[dict[str, Any]]
    error: str | None = None


class _NameAnalysis(ast.NodeVisitor):
    def __init__(self) -> None:
        self.definitions: set[str] = set()
        self.references: set[str] = set()
        self.imports: set[str] = set()
        self.series_requests: list[dict[str, Any]] = []
        self.yield_curve_requests: list[dict[str, Any]] = []
        self.macro_requests: list[dict[str, Any]] = []
        self.fx_requests: list[dict[str, Any]] = []
        self.commodity_requests: list[dict[str, Any]] = []

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.definitions.add(node.id)
        elif isinstance(node.ctx, ast.Load):
            self.references.add(node.id)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            import_root = alias.name.split(".", 1)[0]
            self.imports.add(import_root)
            self.definitions.add(alias.asname or import_root)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            self.imports.add(node.module.split(".", 1)[0])
        for alias in node.names:
            if alias.name != "*":
                self.definitions.add(alias.asname or alias.name)

    def visit_Call(self, node: ast.Call) -> None:
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "series"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.series_requests.append(
                {
                    "line": node.lineno,
                    "asset_type": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("asset_type")
                    ),
                    "identifier": _literal_string(
                        node.args[1] if len(node.args) > 1 else keywords.get("identifier")
                    ),
                    "measure": _literal_string(keywords.get("measure"))
                    if "measure" in keywords
                    else "market.adjusted_close",
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "yield_curve"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.yield_curve_requests.append(
                {
                    "line": node.lineno,
                    "curve": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("curve")
                    ),
                    "tenor": _literal_string(keywords.get("tenor")),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "macro"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.macro_requests.append(
                {
                    "line": node.lineno,
                    "series": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("series")
                    ),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "fx"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.fx_requests.append(
                {
                    "line": node.lineno,
                    "pair": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("pair")
                    ),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr
            in {"commodity_returns", "commodity_warehouse_receipts", "commodity_holdings"}
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.commodity_requests.append(
                {
                    "line": node.lineno,
                    "method": node.func.attr,
                    "product": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("product")
                    ),
                }
            )
        self.generic_visit(node)


class _HostBridge:
    def __init__(
        self,
        read_frame: Callable[[], dict[str, Any]],
        send_frame: Callable[[dict[str, Any]], None],
    ) -> None:
        self._read_frame = read_frame
        self._send_frame = send_frame
        self._request_id = 0

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        self._request_id += 1
        request_id = self._request_id
        remaining, interval = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            self._send_frame(
                {
                    "type": "request",
                    "id": request_id,
                    "method": method,
                    "arguments": arguments,
                }
            )
            response = self._read_frame()
        finally:
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, interval)
        if response.get("type") != "response" or response.get("id") != request_id:
            raise RuntimeError("unexpected research host response")
        if "error" in response:
            raise RuntimeError(str(response["error"]))
        return response.get("result")


class _DataApi:
    def __init__(self, host: _HostBridge, pandas_module: Any) -> None:
        self._host = host
        self._pandas = pandas_module

    def series(
        self,
        asset_type: str,
        identifier: str,
        *,
        start: str,
        end: str,
        measure: str = "market.adjusted_close",
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_series",
            {
                "asset_type": asset_type,
                "identifier": identifier,
                "start": start,
                "end": end,
                "measure": measure,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def cross_section(
        self,
        universe: str,
        *,
        date: str,
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_cross_section",
            {
                "universe": universe,
                "date": date,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._equity_frame(result)

    def yield_curve(
        self,
        curve: str,
        *,
        tenor: str,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_yield_curve",
            {
                "curve": curve,
                "tenor": tenor,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def macro(
        self,
        series: str,
        *,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_macro",
            {
                "series": series,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def fx(
        self,
        pair: str,
        *,
        start: str,
        end: str,
        frequency: str = "daily",
        transform: str = "level",
        partial_period: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_fx",
            {
                "pair": pair,
                "start": start,
                "end": end,
                "frequency": frequency,
                "transform": transform,
                "partial_period": partial_period,
            },
        )
        return self._series_frame(result)

    def panel(
        self,
        universe: str,
        *,
        start: str,
        end: str,
        frequency: str = "month_end",
        minimum_listed_days: int = 365,
        risk_warning: str = "exclude",
    ) -> Any:
        result = self._host.request(
            "research_panel",
            {
                "universe": universe,
                "start": start,
                "end": end,
                "frequency": frequency,
                "minimum_listed_days": minimum_listed_days,
                "risk_warning": risk_warning,
            },
        )
        return self._equity_frame(result)

    def commodity_returns(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_returns",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_RETURN_COLUMNS)

    def commodity_warehouse_receipts(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_warehouse_receipts",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_WAREHOUSE_RECEIPT_COLUMNS)

    def commodity_holdings(self, product: str, *, start: str, end: str) -> Any:
        result = self._host.request(
            "research_commodity_holdings",
            {"product": product, "start": start, "end": end},
        )
        return self._dataset_frame(result, _COMMODITY_HOLDING_COLUMNS)

    def _equity_frame(self, result: Any) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=_EQUITY_DATASET_COLUMNS)
        if not frame.empty:
            frame["date"] = self._pandas.to_datetime(frame["date"], format="%Y%m%d")
        if isinstance(result, dict) and isinstance(result.get("metadata"), dict):
            frame.attrs["jixie"] = result["metadata"]
        return frame

    def _series_frame(self, result: Any) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=["date", "value"])
        if not frame.empty:
            frame["date"] = self._pandas.to_datetime(frame["date"], format="%Y%m%d")
        if isinstance(result, dict) and isinstance(result.get("diagnostics"), list):
            frame.attrs["jixie"] = {"diagnostics": result["diagnostics"]}
        return frame

    def _dataset_frame(self, result: Any, columns: list[str]) -> Any:
        rows = result.get("rows", []) if isinstance(result, dict) else []
        if self._pandas is None:
            return rows
        frame = self._pandas.DataFrame(rows, columns=columns)
        for column in ("date", "trade_date"):
            if not frame.empty:
                frame[column] = self._pandas.to_datetime(frame[column], format="%Y%m%d")
        return frame


class _ResultsApi:
    def __init__(self, host: _HostBridge) -> None:
        self._host = host

    def factor_report(self, report_id: str) -> dict[str, Any]:
        result = self._host.request(
            "research_factor_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Factor report response must be an object")
        return result

    def backtest_report(self, report_id: str) -> dict[str, Any]:
        result = self._host.request(
            "research_backtest_report",
            {"report_id": report_id},
        )
        if not isinstance(result, dict):
            raise RuntimeError("Backtest report response must be an object")
        return result


class _ChartResult:
    def __init__(self, spec: dict[str, Any]) -> None:
        self.spec = spec


class _ChartsApi:
    def line(
        self,
        frame: Any,
        *,
        x: str,
        y: str | list[str],
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        return self._chart("line", frame, x=x, y=y, title=title, labels=labels)

    def area(
        self,
        frame: Any,
        *,
        x: str,
        y: str | list[str],
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        return self._chart("area", frame, x=x, y=y, title=title, labels=labels)

    def bar(
        self,
        frame: Any,
        *,
        x: str,
        y: str | list[str],
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        return self._chart("bar", frame, x=x, y=y, title=title, labels=labels)

    def scatter(
        self,
        frame: Any,
        *,
        x: str,
        y: str,
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        return self._chart("scatter", frame, x=x, y=y, title=title, labels=labels)

    def event_path(
        self,
        frame: Any,
        *,
        x: str,
        y: str | list[str],
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        return self._chart("event_path", frame, x=x, y=y, title=title, labels=labels)

    def histogram(
        self,
        frame: Any,
        *,
        column: str,
        bins: int = 20,
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        if isinstance(bins, bool) or not isinstance(bins, int) or not 1 <= bins <= 100:
            raise ValueError("charts.histogram bins must be an integer from 1 to 100")
        rows = _records(frame, _MAX_CHART_ROWS)
        _require_columns(rows, [column])
        values = _numeric_column(rows, column)
        if not values:
            raise ValueError(f"chart column has no finite numeric values: {column}")

        minimum = min(values)
        maximum = max(values)
        if minimum == maximum:
            histogram_rows = [
                {
                    "bin": _format_bin(minimum),
                    "lower": minimum,
                    "upper": maximum,
                    "count": len(values),
                }
            ]
        else:
            width = (maximum - minimum) / bins
            counts = [0] * bins
            for value in values:
                index = min(int((value - minimum) / width), bins - 1)
                counts[index] += 1
            histogram_rows = []
            for index, count in enumerate(counts):
                lower = minimum + index * width
                upper = maximum if index == bins - 1 else minimum + (index + 1) * width
                histogram_rows.append(
                    {
                        "bin": f"{_format_bin(lower)}–{_format_bin(upper)}",
                        "lower": lower,
                        "upper": upper,
                        "count": count,
                    }
                )

        return _ChartResult(
            {
                "type": "chart",
                "version": 1,
                "kind": "histogram",
                "x": "bin",
                "series": [
                    {"column": "count", "label": (labels or {}).get(column, column)}
                ],
                "rows": histogram_rows,
                **({"title": title} if title else {}),
            }
        )

    def boxplot(
        self,
        frame: Any,
        *,
        y: str | list[str],
        group: str | None = None,
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        rows = _records(frame, _MAX_CHART_ROWS)
        y_columns = [y] if isinstance(y, str) else list(y)
        if not y_columns or len(y_columns) > 20:
            raise ValueError("charts.boxplot requires between 1 and 20 numeric columns")
        _require_columns(rows, [*y_columns, *([group] if group else [])])

        box_rows: list[dict[str, Any]] = []
        if group:
            group_values = list(dict.fromkeys(row[group] for row in rows if row[group] is not None))
            for group_value in group_values:
                for column in y_columns:
                    values = _numeric_column(
                        [row for row in rows if row[group] == group_value], column
                    )
                    if values:
                        label = (labels or {}).get(column, column)
                        category = (
                            str(group_value)
                            if len(y_columns) == 1
                            else f"{group_value} · {label}"
                        )
                        box_rows.append({"category": category, **_box_summary(values)})
        else:
            for column in y_columns:
                values = _numeric_column(rows, column)
                if values:
                    box_rows.append(
                        {
                            "category": (labels or {}).get(column, column),
                            **_box_summary(values),
                        }
                    )
        if not box_rows:
            raise ValueError("charts.boxplot found no finite numeric values")

        series_label = (
            (labels or {}).get(y_columns[0], y_columns[0])
            if len(y_columns) == 1
            else "distribution"
        )
        return _ChartResult(
            {
                "type": "chart",
                "version": 1,
                "kind": "boxplot",
                "x": "category",
                "series": [{"column": "median", "label": series_label}],
                "rows": box_rows,
                **({"title": title} if title else {}),
            }
        )

    def heatmap(
        self,
        frame: Any,
        *,
        x: str,
        y: str,
        value: str,
        title: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> _ChartResult:
        rows = _records(frame, _MAX_CHART_ROWS)
        _require_columns(rows, [x, y, value])
        heatmap_rows: list[dict[str, Any]] = []
        coordinates: set[tuple[Any, Any]] = set()
        for row in rows:
            numeric_value = _numeric_scalar(row[value])
            if numeric_value is None or row[x] is None or row[y] is None:
                continue
            coordinate = (row[x], row[y])
            if coordinate in coordinates:
                raise ValueError("charts.heatmap requires unique x/y coordinates")
            coordinates.add(coordinate)
            heatmap_rows.append({x: row[x], y: row[y], value: numeric_value})
        if not heatmap_rows:
            raise ValueError(f"chart column has no finite numeric values: {value}")

        return _ChartResult(
            {
                "type": "chart",
                "version": 1,
                "kind": "heatmap",
                "x": x,
                "y": y,
                "series": [
                    {"column": value, "label": (labels or {}).get(value, value)}
                ],
                "rows": heatmap_rows,
                **({"title": title} if title else {}),
            }
        )

    def _chart(
        self,
        kind: str,
        frame: Any,
        *,
        x: str,
        y: str | list[str],
        title: str | None,
        labels: dict[str, str] | None,
    ) -> _ChartResult:
        rows = _records(frame, _MAX_CHART_ROWS)
        y_columns = [y] if isinstance(y, str) else list(y)
        if not y_columns or len(y_columns) > _MAX_CHART_SERIES:
            raise ValueError(
                f"charts.{kind} requires between 1 and {_MAX_CHART_SERIES} series"
            )
        if not rows:
            raise ValueError("charts.* requires at least one row")
        _require_columns(rows, [x, *y_columns])
        chart_columns = [x, *y_columns]
        return _ChartResult(
            {
                "type": "chart",
                "version": 1,
                "kind": kind,
                "x": x,
                "series": [
                    {"column": column, "label": (labels or {}).get(column, column)}
                    for column in y_columns
                ],
                "rows": [
                    {column: row[column] for column in chart_columns}
                    for row in rows
                ],
                **({"title": title} if title else {}),
            }
        )


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
    send_frame({"type": "research_ready", "environment": _environment(modules)})

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


def _optional_modules() -> dict[str, Any]:
    modules: dict[str, Any] = {"numpy": None, "pandas": None, "matplotlib": None}
    try:
        import numpy

        modules["numpy"] = numpy
    except ImportError:
        pass
    try:
        import pandas

        modules["pandas"] = pandas
    except ImportError:
        pass
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot

        modules["matplotlib"] = matplotlib.pyplot
    except ImportError:
        pass
    return modules


def _new_namespace(host: _HostBridge, modules: dict[str, Any]) -> dict[str, Any]:
    namespace: dict[str, Any] = {
        "__name__": "__research__",
        "data": _DataApi(host, modules["pandas"]),
        "charts": _ChartsApi(),
        "results": _ResultsApi(host),
    }
    if modules["numpy"] is not None:
        namespace["np"] = modules["numpy"]
    if modules["pandas"] is not None:
        namespace["pd"] = modules["pandas"]
    return namespace


def _environment(modules: dict[str, Any]) -> dict[str, Any]:
    return {
        "runtime": "research-py-v1",
        "python": platform.python_version(),
        "numpy": _module_version(modules["numpy"]),
        "pandas": _module_version(modules["pandas"]),
        "matplotlib": _module_version(modules["matplotlib"]),
        "scipy": _package_version("scipy"),
        "statsmodels": _package_version("statsmodels"),
        "scikit-learn": _package_version("scikit-learn"),
    }


def _module_version(module: Any) -> str | None:
    if module is None:
        return None
    root = sys.modules.get(module.__name__.split(".", 1)[0], module)
    return str(getattr(root, "__version__", "unknown"))


def _package_version(distribution: str) -> str | None:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return None


def _analyze(source: str) -> _Analysis:
    try:
        tree = ast.parse(source or "pass", filename="research_cell.py", mode="exec")
    except SyntaxError as error:
        message = f"{error.msg} (line {error.lineno}, column {error.offset})"
        return _Analysis([], [], [], [], [], [], [], [], message)
    visitor = _NameAnalysis()
    visitor.visit(tree)
    ignored = set(dir(builtins)) | _RUNTIME_NAMES
    return _Analysis(
        sorted(name for name in visitor.definitions if not name.startswith("_")),
        sorted(name for name in visitor.references if name not in ignored and not name.startswith("_")),
        sorted(visitor.imports),
        visitor.series_requests,
        visitor.yield_curve_requests,
        visitor.macro_requests,
        visitor.fx_requests,
        visitor.commodity_requests,
    )


def _literal_string(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


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


def _outputs(value: Any, figures_before: set[int], modules: dict[str, Any]) -> list[dict[str, Any]]:
    outputs: list[dict[str, Any]] = []
    if isinstance(value, _ChartResult):
        outputs.append(value.spec)
    elif _is_pandas_frame(value, modules["pandas"]) or _is_record_table(value):
        outputs.append(_table_output(value))
    elif value is not None:
        safe_value = _json_value(value)
        if isinstance(safe_value, dict):
            outputs.append(
                {"type": "text", "text": json.dumps(safe_value, ensure_ascii=False, indent=2)}
            )
        else:
            outputs.append({"type": "value", "value": safe_value})

    pyplot = modules["matplotlib"]
    if pyplot is not None:
        for figure_number in sorted(_figure_numbers(pyplot) - figures_before):
            figure = pyplot.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", dpi=144, bbox_inches="tight")
            image = buffer.getvalue()
            if len(image) > _MAX_IMAGE_BYTES:
                outputs.append(
                    {
                        "type": "text",
                        "level": "warning",
                        "text": (
                            "Python figure omitted because its PNG artifact is "
                            f"{len(image)} bytes; the limit is {_MAX_IMAGE_BYTES} bytes. "
                            "Reduce figure size or DPI and rerun the Cell."
                        ),
                    }
                )
            else:
                outputs.append(
                    {
                        "type": "image",
                        "mimeType": "image/png",
                        "dataUrl": "data:image/png;base64,"
                        + base64.b64encode(image).decode(),
                        "byteSize": len(image),
                        "alt": "Python figure",
                    }
                )
            pyplot.close(figure)
    return outputs


def _is_pandas_frame(value: Any, pandas_module: Any) -> bool:
    return pandas_module is not None and isinstance(
        value, (pandas_module.DataFrame, pandas_module.Series)
    )


def _is_record_table(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(
        isinstance(row, dict) for row in value[:_MAX_TABLE_ROWS]
    )


def _table_output(value: Any) -> dict[str, Any]:
    if hasattr(value, "to_frame") and not hasattr(value, "columns"):
        value = value.to_frame()

    if hasattr(value, "reset_index") and hasattr(value, "to_dict"):
        row_count = len(value)
        preview = value.iloc[:_MAX_TABLE_ROWS].reset_index()
        column_count = len(preview.columns)
        preview = preview.iloc[:, :_MAX_TABLE_COLUMNS].copy()
        columns = _unique_column_names(preview.columns)
        preview.columns = columns
        raw_rows = preview.to_dict(orient="records")
    elif _is_record_table(value):
        row_count = len(value)
        raw_columns: list[Any] = []
        seen_columns: set[str] = set()
        for row in value[:_MAX_TABLE_ROWS]:
            for key in row:
                normalized = str(key)
                if normalized not in seen_columns:
                    seen_columns.add(normalized)
                    raw_columns.append(key)
        column_count = len(raw_columns)
        selected_columns = raw_columns[:_MAX_TABLE_COLUMNS]
        columns = _unique_column_names(selected_columns)
        raw_rows = [
            {
                column: row.get(raw_column)
                for raw_column, column in zip(selected_columns, columns)
            }
            for row in value[:_MAX_TABLE_ROWS]
        ]
    else:
        raise TypeError("table outputs require a pandas object or a list of records")

    cells_truncated = False
    bytes_truncated = False
    rows: list[dict[str, Any]] = []
    preview_content_byte_size = len(
        json.dumps(
            {"columns": columns, "rows": []},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    for raw_row in raw_rows:
        row: dict[str, Any] = {}
        for column in columns:
            scalar, truncated = _table_scalar(raw_row.get(column))
            row[column] = scalar
            cells_truncated = cells_truncated or truncated
        row_byte_size = len(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ) + (1 if rows else 0)
        if (
            preview_content_byte_size + row_byte_size
            > _MAX_TABLE_PREVIEW_BYTES - 1024
        ):
            bytes_truncated = True
            break
        rows.append(row)
        preview_content_byte_size += row_byte_size

    output = {
        "type": "table",
        "columns": columns,
        "rows": rows,
        "rowCount": row_count,
        "columnCount": column_count,
        "truncated": row_count > len(rows),
        "truncatedColumns": column_count > _MAX_TABLE_COLUMNS,
        "truncatedCells": cells_truncated,
        "truncatedBytes": bytes_truncated,
        "limits": {
            "rows": _MAX_TABLE_ROWS,
            "columns": _MAX_TABLE_COLUMNS,
            "cellCharacters": _MAX_TABLE_CELL_CHARACTERS,
            "bytes": _MAX_TABLE_PREVIEW_BYTES,
        },
    }
    preview_byte_size = 0
    while output.get("previewByteSize") != preview_byte_size:
        output["previewByteSize"] = preview_byte_size
        preview_byte_size = len(
            json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
    return output


def _unique_column_names(columns: Any) -> list[str]:
    names: list[str] = []
    used: set[str] = set()
    for column in columns:
        base = str(column)[:80] or "column"
        candidate = base
        suffix = 1
        while candidate in used:
            suffix += 1
            candidate = f"{base} ({suffix})"
        used.add(candidate)
        names.append(candidate)
    return names


def _table_scalar(value: Any) -> tuple[Any, bool]:
    scalar = _json_scalar(value)
    if not isinstance(scalar, str) or len(scalar) <= _MAX_TABLE_CELL_CHARACTERS:
        return scalar, False
    suffix = " … [truncated]"
    return scalar[: _MAX_TABLE_CELL_CHARACTERS - len(suffix)] + suffix, True


def _figure_numbers(pyplot: Any) -> set[int]:
    return set(pyplot.get_fignums()) if pyplot is not None else set()


def _records(value: Any, limit: int) -> list[dict[str, Any]]:
    if hasattr(value, "to_frame") and not hasattr(value, "columns"):
        value = value.to_frame()
    if hasattr(value, "reset_index") and hasattr(value, "to_dict"):
        row_count = len(value)
        if row_count > limit:
            raise ValueError(
                f"charts.* accepts at most {limit} rows; aggregate or sample explicitly"
            )
        raw_rows = value.reset_index().to_dict(orient="records")
    elif isinstance(value, list):
        if len(value) > limit:
            raise ValueError(
                f"charts.* accepts at most {limit} rows; aggregate or sample explicitly"
            )
        raw_rows = value
    else:
        raise TypeError("chart and table outputs require a pandas object or a list of records")
    if not all(isinstance(row, dict) for row in raw_rows):
        raise TypeError("rows must be objects")
    return [
        {str(key): _json_scalar(item) for key, item in row.items()}
        for row in raw_rows
    ]


def _require_columns(rows: list[dict[str, Any]], columns: list[str]) -> None:
    if not rows:
        raise ValueError("charts.* requires at least one row")
    missing = [column for column in columns if column not in rows[0]]
    if missing:
        raise ValueError(f"chart column(s) not found: {', '.join(missing)}")


def _numeric_scalar(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _numeric_column(rows: list[dict[str, Any]], column: str) -> list[float]:
    values = [_numeric_scalar(row.get(column)) for row in rows]
    return [value for value in values if value is not None]


def _box_summary(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    return {
        "min": ordered[0],
        "q1": _quantile(ordered, 0.25),
        "median": _quantile(ordered, 0.5),
        "q3": _quantile(ordered, 0.75),
        "max": ordered[-1],
    }


def _quantile(ordered: list[float], probability: float) -> float:
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _format_bin(value: float) -> str:
    return f"{value:.6g}"


def _json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value[:_MAX_TABLE_ROWS]]
    return _json_scalar(value)


def _json_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if value == value and abs(value) != float("inf") else None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        return _json_scalar(value.item())
    return str(value)
