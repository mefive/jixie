from __future__ import annotations

import signal
from typing import Any, Callable


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
