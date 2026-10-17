from __future__ import annotations

import signal
from typing import Any, Callable, TypedDict

from infra.sandbox.python.sdk_adapter import SdkAdapter

from ...sdk.python.capabilities import ResearchCapabilities


# 提供研究适配器的宿主请求入口，供单次能力绑定。
# English: Supply the host request entry used to bind research capabilities.
class ResearchAdapterInput(TypedDict):
    read_frame: Callable[[], dict[str, Any]]
    send_frame: Callable[[dict[str, Any]], None]


# 实现数据请求与宿主响应关联，SDK 不直接依赖帧循环。
# English: Associate dataset requests and host responses independently of SDK frame handling.
class ResearchAdapter(SdkAdapter[ResearchAdapterInput, ResearchCapabilities]):
    """One session owns request IDs; each namespace receives a fresh capability binding."""

    def __init__(self) -> None:
        self._request_id = 0

    def bind(self, input: ResearchAdapterInput) -> ResearchCapabilities:
        return BoundResearchCapabilities(
            lambda method, arguments: self._request(input, method, arguments)
        )

    # 同步请求宿主并校验响应身份与错误，供 Python 数据方法使用。
    # English: Request the host synchronously and validate response identity and failure.
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


# 将本轮请求能力绑定为研究 SDK 所需原始能力。
# English: Bind current request access to the primitives required by the Research SDK.
class BoundResearchCapabilities(ResearchCapabilities):
    def __init__(self, request: Callable[[str, dict[str, Any]], Any]) -> None:
        self._request = request

    def request(self, method: str, arguments: dict[str, Any]) -> Any:
        return self._request(method, arguments)
