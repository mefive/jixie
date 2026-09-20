from __future__ import annotations

import json
import os
import signal
import struct
import sys
import traceback
from typing import Any, Callable


_INPUT = sys.stdin.buffer
_OUTPUT = sys.stdout.buffer
_MAX_FRAME_BYTES = 64 * 1024 * 1024
_MAX_LOG_LINES = 2_000
_MAX_LOG_LINE_CHARS = 20_000
_CODE_TIMEOUT_SECONDS = float(os.environ.get("JIXIE_PYTHON_CODE_TIMEOUT_SECONDS", "10"))
_log_lines_emitted = 0
_log_capped = False


def _run_user_code(callback: Callable[[], Any], timeout_label: str = "strategy") -> Any:
    def timeout_user_code(_signum: int, _frame: Any) -> None:
        raise TimeoutError(
            f"Python {timeout_label} exceeded "
            f"{_CODE_TIMEOUT_SECONDS:g}s of uninterrupted execution"
        )

    previous_handler = signal.signal(signal.SIGALRM, timeout_user_code)
    signal.setitimer(signal.ITIMER_REAL, _CODE_TIMEOUT_SECONDS)
    try:
        return callback()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def _read_exact(size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = _INPUT.read(remaining)
        if not chunk:
            raise EOFError("sandbox protocol closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_frame() -> dict[str, Any]:
    size = struct.unpack(">I", _read_exact(4))[0]
    if size > _MAX_FRAME_BYTES:
        raise ValueError(f"sandbox frame exceeds {_MAX_FRAME_BYTES} bytes")
    value = json.loads(_read_exact(size))
    if not isinstance(value, dict):
        raise ValueError("sandbox frame must be an object")
    return value


def _send_frame(value: dict[str, Any]) -> None:
    payload = json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
    if len(payload) > _MAX_FRAME_BYTES:
        raise ValueError(f"sandbox frame exceeds {_MAX_FRAME_BYTES} bytes")
    _OUTPUT.write(struct.pack(">I", len(payload)))
    _OUTPUT.write(payload)
    _OUTPUT.flush()


class _LogStream:
    def __init__(self, level: str) -> None:
        self.level = level
        self.pending = ""

    def write(self, text: str) -> int:
        original_length = len(text)
        self.pending += str(text)
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            if line:
                _emit_log(self.level, line)
        if len(self.pending) > _MAX_LOG_LINE_CHARS:
            _emit_log(self.level, self.pending)
            self.pending = ""
        return original_length

    def flush(self) -> None:
        if self.pending:
            _emit_log(self.level, self.pending)
            self.pending = ""


def _emit_log(level: str, text: str) -> None:
    global _log_lines_emitted, _log_capped
    if _log_lines_emitted >= _MAX_LOG_LINES:
        if not _log_capped:
            _log_capped = True
            _send_frame(
                {
                    "type": "log",
                    "level": "warning",
                    "text": f"Python strategy logs truncated after {_MAX_LOG_LINES} lines",
                }
            )
        return
    _log_lines_emitted += 1
    clipped = text[:_MAX_LOG_LINE_CHARS]
    if len(text) > _MAX_LOG_LINE_CHARS:
        clipped += " … [line truncated]"
    _send_frame({"type": "log", "level": level, "text": clipped})


def main() -> None:
    sys.stdout = _LogStream("info")
    sys.stderr = _LogStream("error")
    start = _read_frame()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    if start.get("type") == "research_start":
        from jixie_research_runtime import run_research

        run_research(
            start,
            _read_frame,
            _send_frame,
            lambda callback: _run_user_code(callback, "research cell"),
        )
        return
    if start.get("type") == "factor_start":
        from jixie_factor_runtime import run_factor

        run_factor(start, _read_frame, _send_frame, _run_user_code)
        return
    # Deployment preserves the business-source layout, so local and container imports agree.
    api_source = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../api/src"))
    sys.path.insert(0, api_source)
    from strategy.runtime.python.runner import run_strategy

    run_strategy(start, _read_frame, _send_frame, _run_user_code)


try:
    main()
except EOFError:
    pass
except Exception:
    _send_frame({"type": "fatal", "message": traceback.format_exc(limit=20)})
