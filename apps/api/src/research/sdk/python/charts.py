from __future__ import annotations

import math
from typing import Any

from .scalars import _json_scalar

_MAX_CHART_ROWS = 5_000

_MAX_CHART_SERIES = 20


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
