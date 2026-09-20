from __future__ import annotations

import signal
import sys
import traceback
import types
from typing import Any, Callable

from ...sdk.python import AttrDict, Context, Strategy, Universe


def _load_strategy(source: str, overrides: dict[str, float | str]) -> Strategy:
    module = types.ModuleType("jixie")
    module.Strategy = Strategy
    module.Universe = Universe
    module.Context = Context
    sys.modules["jixie"] = module

    namespace: dict[str, Any] = {"__name__": "__strategy__"}
    exec(compile(source, "strategy.py", "exec"), namespace, namespace)
    strategy = namespace.get("strategy")
    if not isinstance(strategy, Strategy) or strategy._callback is None:
        raise TypeError(
            "strategy.py must define `strategy = Strategy(...)` and decorate one function with `@strategy.on_bar`"
        )
    unknown = set(overrides) - set(strategy.params)
    if unknown:
        raise ValueError(f"unknown strategy parameter(s): {', '.join(sorted(unknown))}")
    strategy.params.update(overrides)
    return strategy


def _metadata(strategy: Strategy) -> dict[str, Any]:
    return {
        "name": strategy.name,
        "params": strategy.params,
        "factors": strategy.factors,
        "watch": strategy.watch,
        "futures": strategy.futures,
        "accounts": strategy.accounts,
    }


def run_strategy(
    start: dict[str, Any],
    read_frame: Callable[[], dict[str, Any]],
    send_frame: Callable[[dict[str, Any]], None],
    run_user_code: Callable[[Callable[[], Any]], Any],
) -> None:
    if start.get("type") != "start" or start.get("runtime_version") != "py-v1":
        raise ValueError("first sandbox frame must start py-v1")
    strategy = run_user_code(
        lambda: _load_strategy(start["code"], start.get("param_overrides", {}))
    )
    if strategy.futures:
        raise ValueError("py-v1 currently supports stock and ETF strategies only")
    send_frame({"type": "ready", "metadata": _metadata(strategy)})
    bar_cache: dict[str, list[AttrDict]] = {}

    while True:
        message = read_frame()
        if message.get("type") == "close":
            return
        if message.get("type") != "bar":
            raise ValueError(f"unexpected sandbox message: {message.get('type')}")
        request_id = 0

        def request(method: str, arguments: dict[str, Any]) -> dict[str, Any]:
            nonlocal request_id
            request_id += 1
            # Host I/O does not consume the uninterrupted user-code execution budget.
            remaining, interval = signal.getitimer(signal.ITIMER_REAL)
            signal.setitimer(signal.ITIMER_REAL, 0)
            try:
                send_frame(
                    {
                        "type": "request",
                        "id": request_id,
                        "method": method,
                        "arguments": arguments,
                    }
                )
                response = read_frame()
            finally:
                if remaining > 0:
                    signal.setitimer(signal.ITIMER_REAL, remaining, interval)
            if response.get("type") != "response" or response.get("id") != request_id:
                raise RuntimeError("unexpected sandbox host response")
            if "error" in response:
                raise RuntimeError(response["error"])
            return response.get("result", {})

        context = Context(message["snapshot"], strategy.params, bar_cache, request)
        try:
            run_user_code(lambda: strategy._callback(context))
            sys.stdout.flush()
            sys.stderr.flush()
            send_frame({"type": "done", "commands": context._commands})
        except Exception:
            send_frame({"type": "error", "message": traceback.format_exc(limit=20)})
