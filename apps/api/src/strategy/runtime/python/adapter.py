from __future__ import annotations

from typing import Any, Callable, Iterable, NotRequired, TypedDict

from infra.runtime.python.adapter import SdkAdapter

from ...sdk.capabilities import StrategyCapabilities, StrategyStockCapabilities
from ...sdk.python import AttrDict, _objects


class StrategyAdapterAccess(TypedDict):
    request: Callable[[str, dict[str, Any]], dict[str, Any]]


class StrategyStockSnapshot(TypedDict):
    equity: float
    availableCash: float
    positions: list[dict[str, Any]]


class StrategyFuturesSnapshot(TypedDict):
    equity: float
    availableCash: float
    margin: float


class StrategyAdapterInput(TypedDict):
    date: str
    portfolio: dict[str, float]
    stock: StrategyStockSnapshot
    futures: StrategyFuturesSnapshot
    bar_updates: NotRequired[dict[str, dict[str, Any]]]


class StrategyAdapter(SdkAdapter[StrategyAdapterInput, StrategyCapabilities]):
    """One session owns the cache; each binding owns its snapshot and visible cross-section."""

    def __init__(self, input: StrategyAdapterAccess) -> None:
        self._input = input
        self._bars: dict[str, list[AttrDict]] = {}

    def bind(self, input: StrategyAdapterInput) -> BoundStrategyCapabilities:
        snapshot = _objects(input)

        for code, update in snapshot.get("bar_updates", {}).items():
            row = _objects(update)
            rows = self._bars.setdefault(code, [])
            if not rows or rows[-1].date != row.date:
                rows.append(row)

        return BoundStrategyCapabilities(snapshot, self._bars, self._input["request"])


class BoundStockAccountCapabilities(StrategyStockCapabilities):
    def __init__(
        self,
        snapshot: AttrDict,
        command: Callable[[str, dict[str, Any]], None],
    ) -> None:
        self._snapshot = snapshot
        self._emit_command = command

    @property
    def equity(self) -> float:
        return self._snapshot.equity

    @property
    def available_cash(self) -> float:
        return self._snapshot.availableCash

    def positions(self) -> list[AttrDict]:
        return [
            AttrDict(
                code=position.code,
                shares=position.shares,
                avg_cost=position.avgCost,
                market_value=position.marketValue,
            )
            for position in self._snapshot.positions
        ]

    def adjusted_shares(self, code: str) -> float:
        position = next((item for item in self.positions() if item.code == code), None)
        return position.shares if position else 0

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
        self._emit_command(operation, arguments)


class BoundStrategyCapabilities(StrategyCapabilities):
    def __init__(
        self,
        snapshot: AttrDict,
        bar_cache: dict[str, list[AttrDict]],
        request: Callable[[str, dict[str, Any]], dict[str, Any]],
    ) -> None:
        self._snapshot = snapshot
        self._request = request
        self._bars = bar_cache
        self._cross: dict[str, AttrDict] = {}
        self.commands: list[dict[str, Any]] = []
        self._portfolio = AttrDict(equity=snapshot.portfolio.equity)
        self._stock = BoundStockAccountCapabilities(snapshot.stock, self._command)
        self._futures = AttrDict(
            equity=snapshot.futures.equity,
            available_cash=snapshot.futures.availableCash,
            margin=snapshot.futures.margin,
        )

    @property
    def date(self) -> str:
        return self._snapshot.date

    @property
    def portfolio(self) -> AttrDict:
        return self._portfolio

    @property
    def stock(self) -> StrategyStockCapabilities:
        return self._stock

    @property
    def futures(self) -> AttrDict:
        return self._futures

    def load_cross_section(self, index_code: str | None = None) -> list[str]:
        payload = self._request("cross_section", {"index_code": index_code})
        self._cross = {row["code"]: _objects(row) for row in payload["rows"]}
        return payload["codes"]

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

    def _command(self, operation: str, arguments: dict[str, Any]) -> None:
        self.commands.append({"operation": operation, "arguments": arguments})
