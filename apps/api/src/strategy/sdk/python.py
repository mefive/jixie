from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Callable, Iterable, Protocol, cast


_RECURSIVE_WARMUP_MULTIPLIER = 4


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
        # Retained only for source compatibility; capital allocation uses accounts.
        self.futures: list[str] = []
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
            [code for code in self._codes if predicate(cast(AttrDict, self._context.bar(code)), code)],
        )

    def min_list_days(self, days: int) -> "Universe":
        return Universe(
            self._context,
            [
                code
                for code in self._codes
                if self._context.list_days(code) is None
                or cast(int, self._context.list_days(code)) >= days
            ],
        )

    def rank_by(
        self,
        score: Callable[[AttrDict, str], float | None],
        direction: str = "desc",
    ) -> "Universe":
        scored: list[tuple[str, float]] = []
        for code in self._codes:
            value = score(cast(AttrDict, self._context.bar(code)), code)
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


# Structural inputs keep author helpers independent of the sandbox runtime.
class StockAccountCore(Protocol):
    @property
    def equity(self) -> float: ...

    @property
    def available_cash(self) -> float: ...

    def positions(self) -> list[AttrDict]: ...
    def adjusted_shares(self, code: str) -> float: ...
    def command(self, operation: str, arguments: dict[str, Any]) -> None: ...


class ContextCore(Protocol):
    @property
    def portfolio(self) -> AttrDict: ...

    @property
    def futures(self) -> AttrDict: ...

    @property
    def stock(self) -> StockAccountCore: ...

    @property
    def date(self) -> str: ...

    def load_cross_section(self, index_code: str | None = None) -> list[str]: ...
    def bar(self, code: str) -> AttrDict | None: ...
    def ensure_bars(self, codes: Iterable[str]) -> None: ...
    def bars(self, code: str, count: int) -> list[AttrDict]: ...
    def history(self, code: str, field: str, count: int) -> list[float]: ...
    def price(self, code: str) -> float | None: ...
    def list_days(self, code: str) -> int | None: ...
    def industry(self, code: str) -> str | None: ...
    def lhb_net(self, code: str) -> float | None: ...
    def factor(self, name: str, code: str) -> float | None: ...


class Context:
    def __init__(
        self,
        core: ContextCore,
        params: dict[str, float | str],
    ) -> None:
        self._core = core
        self.params = AttrDict(params)
        self.portfolio = core.portfolio
        self.stock = StockAccount(core.stock)
        self.futures = core.futures

    @property
    def date(self) -> str:
        return self._core.date

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
        return Universe(self, self._core.load_cross_section(index_code))

    def bar(self, code: str) -> AttrDict | None:
        return self._core.bar(code)

    def ensure_bars(self, codes: Iterable[str]) -> None:
        self._core.ensure_bars(codes)

    def bars(self, code: str, count: int) -> list[AttrDict]:
        return self._core.bars(code, count)

    def history(self, code: str, field: str, count: int) -> list[float]:
        return self._core.history(code, field, count)

    def price(self, code: str) -> float | None:
        return self._core.price(code)

    def list_days(self, code: str) -> int | None:
        return self._core.list_days(code)

    def industry(self, code: str) -> str | None:
        return self._core.industry(code)

    def lhb_net(self, code: str) -> float | None:
        return self._core.lhb_net(code)

    def factor(self, name: str, code: str) -> float | None:
        return self._core.factor(name, code)

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


class StockAccount:
    def __init__(self, core: StockAccountCore) -> None:
        self._core = core

    @property
    def equity(self) -> float:
        return self._core.equity

    @property
    def available_cash(self) -> float:
        return self._core.available_cash

    def positions(self) -> list[AttrDict]:
        return self._core.positions()

    def adjusted_shares(self, code: str) -> float:
        return self._core.adjusted_shares(code)

    def equal_weight(self, codes: Iterable[str]) -> None:
        values = list(codes)
        weight = 1 / len(values) if values else 0
        self.set_target_weights({code: weight for code in values})

    def set_target_weight(self, code: str, weight: float) -> None:
        self._command("stock.setTargetWeight", code=code, weight=weight)

    def set_target_weights(self, weights: dict[str, float]) -> None:
        self._command("stock.setTargetWeights", weights=weights)

    def order_adjusted_shares(self, code: str, shares: float) -> None:
        self._command("stock.orderAdjustedShares", code=code, shares=shares)

    def order_lots(self, code: str, lots: float) -> None:
        self._command("stock.orderLots", code=code, lots=lots)

    def close_position(self, code: str) -> None:
        self._command("stock.closePosition", code=code)

    def stop_loss_at_adjusted_price(self, code: str, price: float) -> None:
        self._command("stock.stopLossAtAdjustedPrice", code=code, price=price)

    def trailing_stop_by_fraction(self, code: str, percentage: float) -> None:
        self._command("stock.trailingStopByFraction", code=code, percentage=percentage)

    def limit_buy_at_adjusted_price(self, code: str, price: float, shares: float) -> None:
        self._command("stock.limitBuyAtAdjustedPrice", code=code, price=price, shares=shares)

    def take_profit_by_fraction(self, code: str, percentage: float) -> None:
        self._command("stock.takeProfitByFraction", code=code, percentage=percentage)

    def cancel_conditional(self, code: str, kind: str | None = None) -> None:
        self._command("stock.cancelConditional", code=code, kind=kind)

    def _command(self, operation: str, **arguments: Any) -> None:
        self._core.command(operation, arguments)
