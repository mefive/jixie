from __future__ import annotations

from typing import Any


# 将 NumPy、日期与缺失标量规范为安全 JSON 值。
# English: Normalize NumPy, date and missing scalars into safe JSON values.
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
