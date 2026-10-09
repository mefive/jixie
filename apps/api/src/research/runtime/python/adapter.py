from __future__ import annotations

import signal
from typing import Any, Callable, TypedDict

from infra.runtime.python.adapter import SdkAdapter

from ...sdk.python.capabilities import ResearchCapabilities


class ResearchAdapterInput(TypedDict):
    read_frame: Callable[[], dict[str, Any]]
    send_frame: Callable[[dict[str, Any]], None]


class ResearchAdapter(SdkAdapter[ResearchAdapterInput, ResearchCapabilities]):
    """One session owns request IDs; each namespace receives a fresh capability binding."""

    def __init__(self) -> None:
        self._request_id = 0

    def bind(self, input: ResearchAdapterInput) -> ResearchCapabilities:
        return BoundResearchCapabilities(
            lambda method, arguments: self._request(input, method, arguments)
        )

    def _request(self, input: ResearchAdapterInput, method: str, arguments: dict[str, Any]) -> Any:
        self._request_id += 1
        request_id = self._request_id
        remaining, interval = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            input["send_frame"](
                {
                    "type": "request",
                    "id": request_id,
                    "method": method,
                    "arguments": arguments,
                }
            )
            response = input["read_frame"]()
        finally:
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, interval)
        if response.get("type") != "response" or response.get("id") != request_id:
            raise RuntimeError("unexpected research host response")
        if "error" in response:
            raise RuntimeError(str(response["error"]))
        return response.get("result")


class BoundResearchCapabilities(ResearchCapabilities):
    def __init__(self, request: Callable[[str, dict[str, Any]], Any]) -> None:
        self._request = request

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        return self._request(method, arguments)
