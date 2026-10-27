from __future__ import annotations

import signal
import sys
import traceback
import types
from typing import Any, Callable, cast

from ...sdk.python import Context, Strategy, Universe
from .strategy_adapter import StrategyAdapter, StrategyAdapterInput


# 管理策略加载与逐次决策回调，外围通信归 sandboxd。
# English: Manage strategy loading and decision callbacks while sandboxd owns outer communication.
class StrategyRunner:
    """One instance owns one sandbox session and all state shared across its callbacks."""

    # 绑定策略帧通信与用户执行包装器，初始化会话请求身份。
    # English: Bind strategy communication and user execution and initialize request identity.
    def __init__(
        self,
        read_frame: Callable[[], dict[str, Any]],
        send_frame: Callable[[dict[str, Any]], None],
        run_user_code: Callable[[Callable[[], Any]], Any],
    ) -> None:
        self._read_frame = read_frame
        self._send_frame = send_frame
        self._run_user_code = run_user_code
        self._strategy: Strategy
        self._adapter = StrategyAdapter({"request": self._request})
        self._request_id = 0

    def handle(self, frame: dict[str, Any]) -> bool:
        match frame.get("type"):
            case "bar":
                self._execute(frame["snapshot"])
                return True
            case "close":
                return False
            case _:
                raise ValueError(f"unexpected sandbox message: {frame.get('type')}")

    # 加载策略定义并验证元数据，完成同步命令模式握手。
    # English: Load and validate the strategy before synchronous-command handshake.
    def start(self, config: dict[str, Any]) -> None:
        if config.get("type") != "start" or config.get("runtime_version") != "py-v1":
            raise ValueError("first sandbox frame must start py-v1")

        self._strategy = self._run_user_code(
            lambda: self._load_strategy(config["code"], config.get("param_overrides", {}))
        )

        self._send_frame(
            {"type": "ready", "command_mode": "synchronous", "metadata": self._metadata()}
        )

    # 绑定当次决策快照后调用作者回调，返回完成或错误帧。
    # English: Bind the decision snapshot, invoke the authored callback and emit completion or failure.
    def _execute(self, snapshot: StrategyAdapterInput) -> None:
        self._request_id = 0
        capabilities = self._adapter.bind(snapshot)
        context = Context(capabilities, self._strategy.params)

        try:
            # Startup validates that the author registered a callback.
            callback = cast(Callable[[Context], None], self._strategy._callback)
            self._run_user_code(lambda: callback(context))
            sys.stdout.flush()
            sys.stderr.flush()
            self._send_frame({"type": "done"})
        except Exception:
            self._send_frame({"type": "error", "message": traceback.format_exc(limit=20)})

    # 在受限环境加载策略源码并校验单一定义。
    # English: Load strategy source in a restricted environment and validate the definition.
    def _load_strategy(self, source: str, overrides: dict[str, float | str]) -> Strategy:
        module = types.ModuleType("jixie")
        module.__dict__.update(Strategy=Strategy, Universe=Universe, Context=Context)
        sys.modules["jixie"] = module

        namespace: dict[str, Any] = {"__name__": "__strategy__"}
        exec(compile(source, "strategy.py", "exec"), namespace, namespace)
        strategy = namespace.get("strategy")
        if not isinstance(strategy, Strategy) or strategy._callback is None:
            raise TypeError(
                "strategy.py must define `strategy = Strategy(...)` and decorate one function with `@strategy.on_bar`"
            )
        if hasattr(strategy, "accounts") or hasattr(strategy, "futures"):
            raise ValueError("Futures accounts and declarations are retired")

        unknown = set(overrides) - set(strategy.params)
        if unknown:
            raise ValueError(f"unknown strategy parameter(s): {', '.join(sorted(unknown))}")
        strategy.params.update(overrides)

        return strategy

    def _metadata(self) -> dict[str, Any]:
        return {
            "name": self._strategy.name,
            "params": self._strategy.params,
            "factors": self._strategy.factors,
            "watch": self._strategy.watch,
        }

    # 向宿主同步发送能力请求，等待对应响应或抛出宿主错误。
    # English: Send a synchronous capability request and await its response or host failure.
    def _request(self, method: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self._request_id += 1

        # Host I/O does not consume the uninterrupted user-code execution budget.
        remaining, interval = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            self._send_frame(
                {
                    "type": "request",
                    "id": self._request_id,
                    "method": method,
                    "arguments": arguments,
                }
            )
            response = self._read_frame()
        finally:
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, interval)

        return self._receive_response(response)

    def _receive_response(self, response: dict[str, Any]) -> dict[str, Any]:
        if response.get("type") != "response" or response.get("id") != self._request_id:
            raise RuntimeError("unexpected sandbox host response")
        if "error" in response:
            raise RuntimeError(response["error"])

        return response.get("result", {})


def run_strategy(
    start: dict[str, Any],
    receive_commands: Callable[[Callable[[dict[str, Any]], bool]], None],
    read_frame: Callable[[], dict[str, Any]],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any]], Any],
) -> None:
    runner = StrategyRunner(read_frame, send_frame, run_user_code)
    runner.start(start)

    receive_commands(runner.handle)
