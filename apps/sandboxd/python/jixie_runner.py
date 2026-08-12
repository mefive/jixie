from __future__ import annotations

import json
import math
import os
import signal
import struct
import sys
import traceback
import types
from datetime import datetime
from typing import Any, Callable, Iterable


_INPUT = sys.stdin.buffer
_OUTPUT = sys.stdout.buffer
_MAX_FRAME_BYTES = 64 * 1024 * 1024
_MAX_LOG_LINES = 2_000
_MAX_LOG_LINE_CHARS = 20_000
_CODE_TIMEOUT_SECONDS = float(os.environ.get("JIXIE_PYTHON_CODE_TIMEOUT_SECONDS", "10"))
_RECURSIVE_WARMUP_MULTIPLIER = 4
_log_lines_emitted = 0
_log_capped = False


def _timeout_user_code(_signum: int, _frame: Any) -> None:
    raise TimeoutError(
        f"Python strategy exceeded {_CODE_TIMEOUT_SECONDS:g}s of uninterrupted execution"
    )


def _run_user_code(callback: Callable[[], Any]) -> Any:
    previous_handler = signal.signal(signal.SIGALRM, _timeout_user_code)
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


class AttrDict(dict[str, Any]):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error


def _objects(value: Any) -> Any:
    if isinstance(value, dict):
        return AttrDict({key: _objects(item) for key, item in value.items()})
    if isinstance(value, list):
        return [_objects(item) for item in value]
    return value


def _valid_period(period: int) -> bool:
    return (
        isinstance(period, (int, float))
        and not isinstance(period, bool)
        and math.isfinite(period)
        and period > 0
        and int(period) == period
    )


def _recursive_lookback(period: int, extra: int = 0) -> int:
    if not _valid_period(period):
        return 0
    return int(period) * _RECURSIVE_WARMUP_MULTIPLIER + extra


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _ema_series(values: list[float], period: int) -> list[float | None]:
    averages: list[float | None] = [None] * len(values)
    if not _valid_period(period) or len(values) < period:
        return averages

    average = _mean(values[:period])
    averages[period - 1] = average
    alpha = 2 / (period + 1)
    for value_index in range(period, len(values)):
        average = values[value_index] * alpha + average * (1 - alpha)
        averages[value_index] = average
    return averages


def _directional_movement(previous: AttrDict, current: AttrDict) -> AttrDict:
    upward_move = current.adj_high - previous.adj_high
    downward_move = previous.adj_low - current.adj_low
    return AttrDict(
        true_range=max(
            current.adj_high - current.adj_low,
            abs(current.adj_high - previous.adj_close),
            abs(current.adj_low - previous.adj_close),
        ),
        positive=upward_move if upward_move > downward_move and upward_move > 0 else 0,
        negative=downward_move if downward_move > upward_move and downward_move > 0 else 0,
    )


def _directional_values(
    smoothed_true_range: float,
    smoothed_positive_movement: float,
    smoothed_negative_movement: float,
) -> AttrDict:
    if smoothed_true_range == 0:
        return AttrDict(positive_di=0, negative_di=0, dx=0)

    positive_di = 100 * smoothed_positive_movement / smoothed_true_range
    negative_di = 100 * smoothed_negative_movement / smoothed_true_range
    total = positive_di + negative_di
    return AttrDict(
        positive_di=positive_di,
        negative_di=negative_di,
        dx=0 if total == 0 else 100 * abs(positive_di - negative_di) / total,
    )


class Strategy:
    def __init__(
        self,
        *,
        name: str = "Untitled strategy",
        params: dict[str, float | str] | None = None,
        factors: list[str] | None = None,
        watch: list[str] | None = None,
        futures: list[str] | None = None,
        accounts: dict[str, Any] | None = None,
    ) -> None:
        self.name = name
        self.params = dict(params or {})
        self.factors = list(factors or [])
        self.watch = list(watch or [])
        self.futures = list(futures or [])
        self.accounts = accounts
        self._callback: Callable[[Context], None] | None = None

    def on_bar(self, callback: Callable[["Context"], None]) -> Callable[["Context"], None]:
        self._callback = callback
        return callback


class Universe:
    def __init__(self, context: "Context", codes: Iterable[str]) -> None:
        self._context = context
        self._codes = list(codes)

    def where(self, predicate: Callable[[AttrDict, str], bool]) -> "Universe":
        return Universe(
            self._context,
            [code for code in self._codes if predicate(self._context.bar(code), code)],
        )

    def min_list_days(self, days: int) -> "Universe":
        return Universe(
            self._context,
            [
                code
                for code in self._codes
                if self._context.list_days(code) is None
                or self._context.list_days(code) >= days
            ],
        )

    def rank_by(
        self,
        score: Callable[[AttrDict, str], float | None],
        direction: str = "desc",
    ) -> "Universe":
        scored: list[tuple[str, float]] = []
        for code in self._codes:
            value = score(self._context.bar(code), code)
            if value is not None and math.isfinite(value):
                scored.append((code, value))
        scored.sort(key=lambda item: item[1], reverse=direction == "desc")
        return Universe(self._context, [code for code, _value in scored])

    def top(self, count_or_fraction: float) -> list[str]:
        count = (
            max(1, math.floor(len(self._codes) * count_or_fraction))
            if count_or_fraction < 1
            else math.floor(count_or_fraction)
        )
        return self._codes[:count]

    def codes(self) -> list[str]:
        return list(self._codes)

    def __len__(self) -> int:
        return len(self._codes)


class Context:
    def __init__(
        self,
        snapshot: dict[str, Any],
        params: dict[str, float | str],
        bar_cache: dict[str, list[AttrDict]],
    ) -> None:
        self._snapshot = _objects(snapshot)
        self.params = AttrDict(params)
        self._cross: dict[str, AttrDict] = {}
        self._bars = bar_cache
        for code, update in self._snapshot.get("bar_updates", {}).items():
            row = _objects(update)
            rows = self._bars.setdefault(code, [])
            if not rows or rows[-1].date != row.date:
                rows.append(row)
        self._commands: list[dict[str, Any]] = []
        self._request_id = 0

    @property
    def date(self) -> str:
        return self._snapshot.date

    @property
    def cash(self) -> float:
        return self._snapshot.cash

    @property
    def value(self) -> float:
        return self._snapshot.value

    @property
    def available_cash(self) -> float:
        return self._snapshot.available_cash

    def positions(self) -> list[AttrDict]:
        return self._snapshot.positions

    def shares(self, code: str) -> float:
        position = next((item for item in self.positions() if item.code == code), None)
        return position.shares if position else 0

    def period(self, schedule: str) -> str:
        date = datetime.strptime(self.date, "%Y%m%d")
        if schedule == "daily":
            return self.date
        if schedule == "weekly":
            year, week, _weekday = date.isocalendar()
            return f"{year}-W{week:02d}"
        if schedule == "monthly":
            return self.date[:6]
        raise ValueError(f"unknown schedule: {schedule}")

    def universe(self, index_code: str | None = None) -> Universe:
        payload = self._request("cross_section", {"index_code": index_code})
        self._cross = {row["code"]: _objects(row) for row in payload["rows"]}
        return Universe(self, payload["codes"])

    def bar(self, code: str) -> AttrDict | None:
        return self._cross.get(code)

    def ensure_bars(self, codes: Iterable[str]) -> None:
        missing = [
            code
            for code in codes
            if code not in self._bars
            or not self._bars[code]
            or self._bars[code][-1].date != self.date
        ]
        if not missing:
            return
        payload = self._request("bars", {"codes": missing})
        for code, rows in payload["bars"].items():
            self._bars[code] = _objects(rows)

    def bars(self, code: str, count: int) -> list[AttrDict]:
        if code not in self._bars or len(self._bars[code]) < count:
            payload = self._request("bars", {"codes": [code]})
            self._bars[code] = _objects(payload["bars"].get(code, []))
        else:
            self.ensure_bars([code])
        return self._bars.get(code, [])[-max(0, int(count)) :]

    def history(self, code: str, field: str, count: int) -> list[float]:
        field_name = field if field.startswith("adj_") else f"adj_{field}"
        if field_name not in {"adj_open", "adj_high", "adj_low", "adj_close"}:
            raise ValueError(
                "history field must be open, high, low, close, or its adj_ equivalent"
            )
        return [row[field_name] for row in self.bars(code, count)]

    def price(self, code: str) -> float | None:
        values = self.history(code, "close", 1)
        return values[-1] if values else None

    def list_days(self, code: str) -> int | None:
        row = self.bar(code)
        return row.list_days if row else None

    def industry(self, code: str) -> str | None:
        row = self.bar(code)
        return row.industry if row else None

    def lhb_net(self, code: str) -> float | None:
        row = self.bar(code)
        return row.lhb_net if row else None

    def factor(self, name: str, code: str) -> float | None:
        row = self.bar(code)
        return row.factors.get(name) if row else None

    def sma(self, code: str, count: int) -> float | None:
        values = self.history(code, "close", count)
        return sum(values) / count if len(values) == count else None

    def ema(self, code: str, count: int) -> float | None:
        values = self.history(code, "close", count * 4)
        if len(values) < count:
            return None
        alpha = 2 / (count + 1)
        result = values[0]
        for value in values[1:]:
            result = alpha * value + (1 - alpha) * result
        return result

    def atr(self, code: str, count: int) -> float | None:
        rows = self.bars(code, count + 1)
        if len(rows) < count + 1:
            return None
        ranges = []
        for index in range(1, len(rows)):
            current = rows[index]
            previous = rows[index - 1]
            ranges.append(
                max(
                    current.adj_high - current.adj_low,
                    abs(current.adj_high - previous.adj_close),
                    abs(current.adj_low - previous.adj_close),
                )
            )
        return sum(ranges[-count:]) / count

    def highest(self, code: str, field: str, count: int) -> float | None:
        values = self.history(code, field, count)
        return max(values) if len(values) == count else None

    def lowest(self, code: str, field: str, count: int) -> float | None:
        values = self.history(code, field, count)
        return min(values) if len(values) == count else None

    def avg_amount(self, code: str, count: int) -> float | None:
        values = [row.amount for row in self.bars(code, count) if row.amount is not None]
        return sum(values) / count if len(values) == count else None

    def avg_vol(self, code: str, count: int) -> float | None:
        values = [row.vol for row in self.bars(code, count) if row.vol is not None]
        return sum(values) / count if len(values) == count else None

    def adx(self, code: str, period: int = 14) -> AttrDict | None:
        if not _valid_period(period):
            return None
        period = int(period)
        rows = self.bars(code, _recursive_lookback(period))
        if len(rows) < period * 2:
            return None

        smoothed_true_range = 0.0
        smoothed_positive_movement = 0.0
        smoothed_negative_movement = 0.0
        for bar_index in range(1, period + 1):
            movement = _directional_movement(rows[bar_index - 1], rows[bar_index])
            smoothed_true_range += movement.true_range
            smoothed_positive_movement += movement.positive
            smoothed_negative_movement += movement.negative

        directional = _directional_values(
            smoothed_true_range,
            smoothed_positive_movement,
            smoothed_negative_movement,
        )
        directional_indices = [directional.dx]
        average_directional_index: float | None = (
            directional.dx if period == 1 else None
        )
        for bar_index in range(period + 1, len(rows)):
            movement = _directional_movement(rows[bar_index - 1], rows[bar_index])
            smoothed_true_range = (
                smoothed_true_range
                - smoothed_true_range / period
                + movement.true_range
            )
            smoothed_positive_movement = (
                smoothed_positive_movement
                - smoothed_positive_movement / period
                + movement.positive
            )
            smoothed_negative_movement = (
                smoothed_negative_movement
                - smoothed_negative_movement / period
                + movement.negative
            )
            directional = _directional_values(
                smoothed_true_range,
                smoothed_positive_movement,
                smoothed_negative_movement,
            )

            if len(directional_indices) < period:
                directional_indices.append(directional.dx)
                if len(directional_indices) == period:
                    average_directional_index = _mean(directional_indices)
            else:
                average_directional_index = (
                    (average_directional_index or 0) * (period - 1) + directional.dx
                ) / period

        if average_directional_index is None:
            return None
        return AttrDict(
            adx=average_directional_index,
            positive_di=directional.positive_di,
            negative_di=directional.negative_di,
        )

    def bollinger_bands(
        self,
        code: str,
        period: int = 20,
        standard_deviations: float = 2,
    ) -> AttrDict | None:
        if (
            not _valid_period(period)
            or not math.isfinite(standard_deviations)
            or standard_deviations < 0
        ):
            return None
        period = int(period)
        values = self.history(code, "close", period)
        if len(values) < period:
            return None

        middle = _mean(values)
        variance = sum((value - middle) ** 2 for value in values) / len(values)
        width = math.sqrt(variance) * standard_deviations
        return AttrDict(middle=middle, upper=middle + width, lower=middle - width)

    def rsi(self, code: str, period: int = 14) -> float | None:
        if not _valid_period(period):
            return None
        period = int(period)
        values = self.history(code, "close", _recursive_lookback(period, 1))
        if len(values) < period + 1:
            return None

        average_gain = 0.0
        average_loss = 0.0
        for value_index in range(1, period + 1):
            change = values[value_index] - values[value_index - 1]
            average_gain += max(change, 0)
            average_loss += max(-change, 0)
        average_gain /= period
        average_loss /= period

        for value_index in range(period + 1, len(values)):
            change = values[value_index] - values[value_index - 1]
            average_gain = (
                average_gain * (period - 1) + max(change, 0)
            ) / period
            average_loss = (
                average_loss * (period - 1) + max(-change, 0)
            ) / period

        if average_gain == 0 and average_loss == 0:
            return 50
        if average_loss == 0:
            return 100
        return 100 - 100 / (1 + average_gain / average_loss)

    def macd(
        self,
        code: str,
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9,
    ) -> AttrDict | None:
        if (
            not _valid_period(fast_period)
            or not _valid_period(slow_period)
            or not _valid_period(signal_period)
            or fast_period >= slow_period
        ):
            return None
        fast_period = int(fast_period)
        slow_period = int(slow_period)
        signal_period = int(signal_period)
        lookback = _recursive_lookback(slow_period, signal_period - 1)
        values = self.history(code, "close", lookback)
        if len(values) < slow_period + signal_period - 1:
            return None

        fast_averages = _ema_series(values, fast_period)
        slow_averages = _ema_series(values, slow_period)
        lines = [
            fast - slow
            for fast, slow in zip(fast_averages, slow_averages)
            if fast is not None and slow is not None
        ]
        signals = _ema_series(lines, signal_period)
        line = lines[-1] if lines else None
        signal = signals[-1] if signals else None
        if line is None or signal is None:
            return None
        return AttrDict(line=line, signal=signal, histogram=line - signal)

    def kdj(
        self,
        code: str,
        period: int = 9,
        k_smoothing: int = 3,
        d_smoothing: int = 3,
    ) -> AttrDict | None:
        if (
            not _valid_period(period)
            or not _valid_period(k_smoothing)
            or not _valid_period(d_smoothing)
        ):
            return None
        period = int(period)
        k_smoothing = int(k_smoothing)
        d_smoothing = int(d_smoothing)
        rows = self.bars(code, _recursive_lookback(period))
        if len(rows) < period:
            return None

        k_value = 50.0
        d_value = 50.0
        j_value = 50.0
        for row_index, row in enumerate(rows):
            start = max(0, row_index - period + 1)
            window = rows[start : row_index + 1]
            highest = max(window_row.adj_high for window_row in window)
            lowest = min(window_row.adj_low for window_row in window)
            raw_stochastic_value = (
                100 * (row.adj_close - lowest) / (highest - lowest)
                if highest > lowest
                else k_value
            )
            k_value = (
                (k_smoothing - 1) * k_value + raw_stochastic_value
            ) / k_smoothing
            d_value = ((d_smoothing - 1) * d_value + k_value) / d_smoothing
            j_value = 3 * k_value - 2 * d_value
        return AttrDict(k=k_value, d=d_value, j=j_value)

    def equal_weight(self, codes: Iterable[str]) -> None:
        values = list(codes)
        weight = 1 / len(values) if values else 0
        self.set_holdings({code: weight for code in values})

    def order_target_percent(self, code: str, weight: float) -> None:
        self._command("order_target_percent", code=code, weight=weight)

    def set_holdings(self, weights: dict[str, float]) -> None:
        self._command("set_holdings", weights=weights)

    def order(self, code: str, shares: float) -> None:
        self._command("order", code=code, shares=shares)

    def order_lots(self, code: str, lots: float) -> None:
        self._command("order_lots", code=code, lots=lots)

    def exit(self, code: str) -> None:
        self._command("exit", code=code)

    def stop_loss(self, code: str, price: float) -> None:
        self._command("stop_loss", code=code, price=price)

    def trailing_stop(self, code: str, percentage: float) -> None:
        self._command("trailing_stop", code=code, percentage=percentage)

    def limit_buy(self, code: str, price: float, shares: float) -> None:
        self._command("limit_buy", code=code, price=price, shares=shares)

    def take_profit(self, code: str, percentage: float) -> None:
        self._command("take_profit", code=code, percentage=percentage)

    def cancel_conditional(self, code: str, kind: str | None = None) -> None:
        self._command("cancel_conditional", code=code, kind=kind)

    def _command(self, operation: str, **arguments: Any) -> None:
        self._commands.append({"operation": operation, "arguments": arguments})

    def _request(self, method: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self._request_id += 1
        request_id = self._request_id
        # Host I/O can legitimately take seconds on a cold market-data query. Pause the user-code
        # timer while waiting so the limit measures uninterrupted strategy execution, not Engine I/O.
        remaining, interval = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, 0)
        try:
            _send_frame(
                {
                    "type": "request",
                    "id": request_id,
                    "method": method,
                    "arguments": arguments,
                }
            )
            response = _read_frame()
        finally:
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, interval)
        if response.get("type") != "response" or response.get("id") != request_id:
            raise RuntimeError("unexpected sandbox host response")
        if "error" in response:
            raise RuntimeError(response["error"])
        return response.get("result", {})


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


def main() -> None:
    sys.stdout = _LogStream("info")
    sys.stderr = _LogStream("error")
    start = _read_frame()
    if start.get("type") != "start" or start.get("runtime_version") != "py-v1":
        raise ValueError("first sandbox frame must start py-v1")
    strategy = _run_user_code(
        lambda: _load_strategy(start["code"], start.get("param_overrides", {}))
    )
    if strategy.futures:
        raise ValueError("py-v1 currently supports stock and ETF strategies only")
    if any(factor not in {"mf_net_main", "mf_net_total"} for factor in strategy.factors):
        raise ValueError("py-v1 does not yet support published TypeScript factors")
    _send_frame({"type": "ready", "metadata": _metadata(strategy)})
    bar_cache: dict[str, list[AttrDict]] = {}

    while True:
        message = _read_frame()
        if message.get("type") == "close":
            return
        if message.get("type") != "bar":
            raise ValueError(f"unexpected sandbox message: {message.get('type')}")
        context = Context(message["snapshot"], strategy.params, bar_cache)
        try:
            _run_user_code(lambda: strategy._callback(context))
            sys.stdout.flush()
            sys.stderr.flush()
            _send_frame({"type": "done", "commands": context._commands})
        except Exception:
            _send_frame({"type": "error", "message": traceback.format_exc(limit=20)})


try:
    main()
except EOFError:
    pass
except Exception:
    _send_frame({"type": "fatal", "message": traceback.format_exc(limit=20)})
