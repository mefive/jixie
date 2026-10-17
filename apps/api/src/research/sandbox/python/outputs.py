from __future__ import annotations

import base64
import io
import json
from typing import Any

from ...sdk.python.charts import _ChartResult
from ...sdk.python.scalars import _json_scalar

_MAX_TABLE_ROWS = 200

_MAX_TABLE_COLUMNS = 64

_MAX_TABLE_CELL_CHARACTERS = 256

_MAX_TABLE_PREVIEW_BYTES = 1 * 1024 * 1024

_MAX_IMAGE_BYTES = 4 * 1024 * 1024


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


def _json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value[:_MAX_TABLE_ROWS]]
    return _json_scalar(value)
