from __future__ import annotations

import ast
import builtins
from dataclasses import dataclass
from typing import Any

_RUNTIME_NAMES = {"charts", "data", "np", "pd", "results", "valuation"}


@dataclass
class _Analysis:
    definitions: list[str]
    references: list[str]
    imports: list[str]
    series_requests: list[dict[str, Any]]
    yield_curve_requests: list[dict[str, Any]]
    macro_requests: list[dict[str, Any]]
    fx_requests: list[dict[str, Any]]
    commodity_requests: list[dict[str, Any]]
    equity_requests: list[dict[str, Any]]
    error: str | None = None


class _NameAnalysis(ast.NodeVisitor):
    def __init__(self) -> None:
        self.definitions: set[str] = set()
        self.references: set[str] = set()
        self.imports: set[str] = set()
        self.series_requests: list[dict[str, Any]] = []
        self.yield_curve_requests: list[dict[str, Any]] = []
        self.macro_requests: list[dict[str, Any]] = []
        self.fx_requests: list[dict[str, Any]] = []
        self.commodity_requests: list[dict[str, Any]] = []
        self.equity_requests: list[dict[str, Any]] = []

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.definitions.add(node.id)
        elif isinstance(node.ctx, ast.Load):
            self.references.add(node.id)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.definitions.add(node.name)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            import_root = alias.name.split(".", 1)[0]
            self.imports.add(import_root)
            self.definitions.add(alias.asname or import_root)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            self.imports.add(node.module.split(".", 1)[0])
        for alias in node.names:
            if alias.name != "*":
                self.definitions.add(alias.asname or alias.name)

    def visit_Call(self, node: ast.Call) -> None:
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "series"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.series_requests.append(
                {
                    "line": node.lineno,
                    "asset_type": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("asset_type")
                    ),
                    "identifier": _literal_string(
                        node.args[1] if len(node.args) > 1 else keywords.get("identifier")
                    ),
                    "measure": _literal_string(keywords.get("measure"))
                    if "measure" in keywords
                    else "market.adjusted_close",
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "yield_curve"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.yield_curve_requests.append(
                {
                    "line": node.lineno,
                    "curve": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("curve")
                    ),
                    "tenor": _literal_string(keywords.get("tenor")),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "macro"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.macro_requests.append(
                {
                    "line": node.lineno,
                    "series": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("series")
                    ),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "fx"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.fx_requests.append(
                {
                    "line": node.lineno,
                    "pair": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("pair")
                    ),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr
            in {"commodity_returns", "commodity_warehouse_receipts", "commodity_holdings"}
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            self.commodity_requests.append(
                {
                    "line": node.lineno,
                    "method": node.func.attr,
                    "product": _literal_string(
                        node.args[0] if len(node.args) > 0 else keywords.get("product")
                    ),
                }
            )
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr
            in {
                "equity_fundamentals",
                "equity_flows",
                "equity_dividends",
                "etf_shares",
                "index_valuation",
                "industry_state",
                "futures_settlement",
                "equity_financial_values",
                "equity_financial_statements",
                "equity_financial_metrics",
                "equity_financial_cross_section",
                "equity_financial_panel",
            }
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "data"
        ):
            keywords = {item.arg: item.value for item in node.keywords if item.arg is not None}
            argument = node.args[0] if node.args else keywords.get("identifiers" if node.func.attr == "equity_financial_values" else "identifier")
            arguments = argument.elts if node.func.attr == "equity_financial_values" and isinstance(argument, (ast.List, ast.Tuple)) else [argument]
            for identifier in arguments:
                self.equity_requests.append({
                    "line": node.lineno,
                    "method": node.func.attr,
                    "identifier": _literal_string(identifier),
                })
        self.generic_visit(node)


def _analyze(source: str) -> _Analysis:
    try:
        tree = ast.parse(source or "pass", filename="research_cell.py", mode="exec")
    except SyntaxError as error:
        message = f"{error.msg} (line {error.lineno}, column {error.offset})"
        return _Analysis([], [], [], [], [], [], [], [], [], message)
    visitor = _NameAnalysis()
    visitor.visit(tree)
    ignored = set(dir(builtins)) | _RUNTIME_NAMES
    return _Analysis(
        sorted(name for name in visitor.definitions if not name.startswith("_")),
        sorted(name for name in visitor.references if name not in ignored and not name.startswith("_")),
        sorted(visitor.imports),
        visitor.series_requests,
        visitor.yield_curve_requests,
        visitor.macro_requests,
        visitor.fx_requests,
        visitor.commodity_requests,
        visitor.equity_requests,
    )


def _literal_string(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None
