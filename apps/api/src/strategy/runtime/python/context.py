from __future__ import annotations

from typing import Any, Callable, Iterable

from ...sdk.python import AttrDict, _objects


class StrategyContextAdapter:
    def __init__(
        self,
        snapshot: dict[str, Any],
        bar_cache: dict[str, list[AttrDict]],
        request: Callable[[str, dict[str, Any]], dict[str, Any]],
    ) -> None:
        self._snapshot = _objects(snapshot)
        self._cross: dict[str, AttrDict] = {}
        self._bars = bar_cache

        for code, update in self._snapshot.get("bar_updates", {}).items():
            row = _objects(update)
            rows = self._bars.setdefault(code, [])
            if not rows or rows[-1].date != row.date:
                rows.append(row)

        self.commands: list[dict[str, Any]] = []
        self._request = request

        self.portfolio = AttrDict(equity=self._snapshot.portfolio.equity)
        self.stock = StockAccountAdapter(self)
        self.futures = AttrDict(
            equity=self._snapshot.futures.equity,
            available_cash=self._snapshot.futures.availableCash,
            margin=self._snapshot.futures.margin,
        )

    @property
    def date(self) -> str:
        return self._snapshot.date

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


class StockAccountAdapter:
    def __init__(self, context: StrategyContextAdapter) -> None:
        self._context = context

    @property
    def equity(self) -> float:
        return self._context._snapshot.stock.equity

    @property
    def available_cash(self) -> float:
        return self._context._snapshot.stock.availableCash

    def positions(self) -> list[AttrDict]:
        return [
            AttrDict(
                code=position.code,
                shares=position.shares,
                avg_cost=position.avgCost,
                market_value=position.marketValue,
            )
            for position in self._context._snapshot.stock.positions
        ]

    def adjusted_shares(self, code: str) -> float:
        position = next((item for item in self.positions() if item.code == code), None)
        return position.shares if position else 0

    def command(self, operation: str, arguments: dict[str, Any]) -> None:
        self._context.commands.append({"operation": operation, "arguments": arguments})
