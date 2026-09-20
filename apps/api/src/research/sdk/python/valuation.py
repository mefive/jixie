from __future__ import annotations

import math
import sys
from typing import Any


class _ValuationApi:
    _BASE_COLUMNS = ["revenue", "nopat_margin"]
    _SCENARIO_COLUMNS = [
        "scenario",
        "revenue_growth",
        "target_nopat_margin",
        "incremental_capital_turnover",
        "wacc",
        "terminal_growth",
        "terminal_roic",
    ]
    _BRIDGE_COLUMNS = ["bridge_adjustment", "issued_shares", "operating_cash_required"]

    def __init__(self, pandas_module: Any) -> None:
        self._pandas = pandas_module

    def fcff_scenarios(
        self,
        base: Any,
        scenarios: Any,
        bridge: Any,
        *,
        forecast_years: int = 5,
        terminal_value_warning_threshold: float = 0.75,
    ) -> Any:
        base_row = self._one_row(base, self._BASE_COLUMNS, "base")
        scenario_rows = self._rows(scenarios, self._SCENARIO_COLUMNS, "scenarios", 20)
        bridge_row = self._one_row(bridge, self._BRIDGE_COLUMNS, "bridge")
        self._validate_years(forecast_years)
        warning_threshold = self._finite(
            "terminal_value_warning_threshold", terminal_value_warning_threshold
        )
        if not 0 <= warning_threshold <= 1:
            raise ValueError("terminal_value_warning_threshold_must_be_between_zero_and_one")

        if any(not isinstance(row["scenario"], str) for row in scenario_rows):
            raise ValueError("scenario_name_must_be_non_empty_string")
        scenario_names = [row["scenario"].strip() for row in scenario_rows]
        if any(not name for name in scenario_names):
            raise ValueError("scenario_name_must_be_non_empty")
        if len(set(scenario_names)) != len(scenario_names):
            raise ValueError("scenario_names_must_be_unique")

        rows: list[dict[str, Any]] = []
        for scenario_row, scenario_name in zip(scenario_rows, scenario_names):
            scenario_row = {**scenario_row, "scenario": scenario_name}
            rows.extend(
                self._scenario_rows(
                    base_row,
                    scenario_row,
                    bridge_row,
                    forecast_years,
                    warning_threshold,
                )
            )
        return self._frame(rows)

    def implied_revenue_growth(
        self,
        base: Any,
        scenario: Any,
        bridge: Any,
        *,
        target_enterprise_value: float,
        forecast_years: int = 5,
        lower: float = -0.20,
        upper: float = 0.30,
        tolerance: float = 1e-8,
        minimum_value_span_fraction: float = 0.05,
    ) -> Any:
        base_row = self._one_row(base, self._BASE_COLUMNS, "base")
        scenario_row = self._one_row(scenario, self._SCENARIO_COLUMNS, "scenario")
        bridge_row = self._one_row(bridge, self._BRIDGE_COLUMNS, "bridge")
        self._validate_years(forecast_years)
        target = self._finite("target_enterprise_value", target_enterprise_value)
        lower_bound = self._finite("lower", lower)
        upper_bound = self._finite("upper", upper)
        solving_tolerance = self._finite("tolerance", tolerance)
        minimum_span = self._finite(
            "minimum_value_span_fraction", minimum_value_span_fraction
        )
        if lower_bound >= upper_bound:
            raise ValueError("reverse_bounds_must_be_in_ascending_order")
        if lower_bound <= -1:
            raise ValueError("lower_bound_must_be_greater_than_minus_one")
        if solving_tolerance <= 0:
            raise ValueError("tolerance_must_be_positive")
        if minimum_span < 0:
            raise ValueError("minimum_value_span_fraction_must_be_non_negative")

        from numpy.polynomial import Polynomial
        from scipy.optimize import brentq

        validated = self._validated_values(base_row, scenario_row, bridge_row)
        # Enterprise value is a degree-N polynomial in q = 1 + revenue_growth.
        # Its stationary points partition the interval into monotone pieces, so a
        # fixed scan cannot hide two nearby roots or a root tangent to the target.
        coefficients = [0.0] * (forecast_years + 1)
        try:
            for year in range(1, forecast_years + 1):
                margin = validated["base_nopat_margin"] + (
                    validated["target_nopat_margin"] - validated["base_nopat_margin"]
                ) * year / forecast_years
                scale = validated["revenue"] / (1 + validated["wacc"]) ** year
                coefficients[year] += scale * (
                    margin - 1 / validated["incremental_capital_turnover"]
                )
                coefficients[year - 1] += scale / validated["incremental_capital_turnover"]
            coefficients[-1] += (
                validated["revenue"] * (1 + validated["terminal_growth"])
                * validated["target_nopat_margin"]
                * (1 - validated["terminal_growth"] / validated["terminal_roic"])
                / (validated["wacc"] - validated["terminal_growth"])
                / (1 + validated["wacc"]) ** forecast_years
            )
            if not all(math.isfinite(value) for value in coefficients):
                raise ArithmeticError("non_finite_coefficients")
            stationary = Polynomial(coefficients).deriv().roots()
            points = sorted(set([lower_bound, upper_bound] + [
                float(root.real) - 1 for root in stationary
                if abs(root.imag) <= 1e-10 * max(1.0, abs(root.real))
                and lower_bound < float(root.real) - 1 < upper_bound
            ]))
            values = [self._enterprise_value_for_growth(
                base_row, scenario_row, bridge_row, forecast_years, growth
            ) for growth in points]
            if not all(math.isfinite(value) for value in values):
                raise ArithmeticError("non_finite_values")
        except (ArithmeticError, ValueError):
            return self._solver_frame(
                "non_finite_scan", math.nan, lower_bound, upper_bound, target,
                "valuation_function_returned_non_finite_values",
            )
        value_span_fraction = (max(values) - min(values)) / max(abs(target), 1.0)
        if value_span_fraction < minimum_span or max(values) == min(values):
            return self._solver_frame(
                "weakly_identified", math.nan, lower_bound, upper_bound, target,
                "valuation_changes_too_little_across_search_bounds",
            )

        residuals = [value - target for value in values]
        value_tolerance = 64 * sys.float_info.epsilon * max(
            1.0, abs(target), max(abs(value) for value in values)
        )
        roots = [points[index] for index, residual in enumerate(residuals)
                 if abs(residual) <= value_tolerance]
        for index in range(len(points) - 1):
            if (abs(residuals[index]) > value_tolerance
                    and abs(residuals[index + 1]) > value_tolerance
                    and (residuals[index] < 0) != (residuals[index + 1] < 0)):
                roots.append(brentq(
                    lambda growth: self._enterprise_value_for_growth(
                        base_row, scenario_row, bridge_row, forecast_years, growth
                    ) - target,
                    points[index], points[index + 1], xtol=solving_tolerance,
                    maxiter=200,
                ))

        unique_roots: list[float] = []
        for root in sorted(roots):
            if not unique_roots or abs(root - unique_roots[-1]) > max(
                solving_tolerance * 2, 1e-12
            ):
                unique_roots.append(root)
        if not unique_roots:
            return self._solver_frame(
                "no_solution",
                math.nan,
                lower_bound,
                upper_bound,
                target,
                "target_value_not_bracketed",
            )
        if len(unique_roots) > 1:
            return self._solver_frame(
                "multiple_solutions",
                math.nan,
                lower_bound,
                upper_bound,
                target,
                f"found_{len(unique_roots)}_solutions",
            )
        return self._solver_frame(
            "solved",
            unique_roots[0],
            lower_bound,
            upper_bound,
            target,
            "unique_solution_within_declared_bounds",
        )

    def _scenario_rows(
        self,
        base: dict[str, Any],
        scenario: dict[str, Any],
        bridge: dict[str, Any],
        forecast_years: int,
        warning_threshold: float,
    ) -> list[dict[str, Any]]:
        values = self._validated_values(base, scenario, bridge)
        previous_revenue = values["revenue"]
        rows: list[dict[str, Any]] = []
        for year in range(1, forecast_years + 1):
            revenue = previous_revenue * (1 + values["revenue_growth"])
            nopat_margin = values["base_nopat_margin"] + (
                values["target_nopat_margin"] - values["base_nopat_margin"]
            ) * year / forecast_years
            nopat = revenue * nopat_margin
            reinvestment = (
                revenue - previous_revenue
            ) / values["incremental_capital_turnover"]
            fcff = nopat - reinvestment
            rows.append(
                {
                    "scenario": scenario["scenario"],
                    "year": year,
                    "revenue": revenue,
                    "nopat_margin": nopat_margin,
                    "nopat": nopat,
                    "reinvestment": reinvestment,
                    "fcff": fcff,
                    "present_value_fcff": fcff / ((1 + values["wacc"]) ** year),
                }
            )
            previous_revenue = revenue

        terminal_revenue = previous_revenue * (1 + values["terminal_growth"])
        terminal_nopat = terminal_revenue * values["target_nopat_margin"]
        terminal_reinvestment_rate = values["terminal_growth"] / values["terminal_roic"]
        terminal_fcff = terminal_nopat * (1 - terminal_reinvestment_rate)
        terminal_value = terminal_fcff / (values["wacc"] - values["terminal_growth"])
        present_value_terminal = terminal_value / ((1 + values["wacc"]) ** forecast_years)
        enterprise_value = sum(row["present_value_fcff"] for row in rows) + present_value_terminal
        equity_value = enterprise_value - values["bridge_adjustment"]
        terminal_value_share = (
            present_value_terminal / enterprise_value if enterprise_value != 0 else math.nan
        )
        diagnostics = []
        if math.isfinite(terminal_value_share) and terminal_value_share > warning_threshold:
            diagnostics.append("high_terminal_value_share")
        if equity_value <= 0:
            diagnostics.append("non_positive_equity_value")
        if values["operating_cash_required"] == 0:
            diagnostics.append("operating_cash_assumption_requires_review")

        if not all(math.isfinite(value) for value in [
            present_value_terminal, enterprise_value, equity_value,
            equity_value / values["issued_shares"],
            *[value for row in rows for value in row.values() if isinstance(value, (int, float))],
        ]):
            raise ValueError("non_finite_valuation")

        summary = {
            "formula_version": "fcff-scenarios-v1",
            "present_value_terminal": present_value_terminal,
            "enterprise_value": enterprise_value,
            "bridge_adjustment": values["bridge_adjustment"],
            "equity_value": equity_value,
            "issued_shares": values["issued_shares"],
            "per_share_value_cny": equity_value / values["issued_shares"],
            "terminal_value_share": terminal_value_share,
            "terminal_reinvestment_rate": terminal_reinvestment_rate,
            "diagnostics": "ok" if not diagnostics else ";".join(diagnostics),
        }
        return [{**row, **summary} for row in rows]

    def _enterprise_value_for_growth(
        self,
        base: dict[str, Any],
        scenario: dict[str, Any],
        bridge: dict[str, Any],
        forecast_years: int,
        growth: float,
    ) -> float:
        candidate = {**scenario, "scenario": "reverse", "revenue_growth": growth}
        rows = self._scenario_rows(base, candidate, bridge, forecast_years, 1.0)
        return float(rows[0]["enterprise_value"])

    def _validated_values(
        self, base: dict[str, Any], scenario: dict[str, Any], bridge: dict[str, Any]
    ) -> dict[str, float]:
        values = {
            "revenue": self._finite("base_revenue", base["revenue"]),
            "base_nopat_margin": self._finite("base_nopat_margin", base["nopat_margin"]),
            "revenue_growth": self._finite("revenue_growth", scenario["revenue_growth"]),
            "target_nopat_margin": self._finite(
                "target_nopat_margin", scenario["target_nopat_margin"]
            ),
            "incremental_capital_turnover": self._finite(
                "incremental_capital_turnover", scenario["incremental_capital_turnover"]
            ),
            "wacc": self._finite("wacc", scenario["wacc"]),
            "terminal_growth": self._finite("terminal_growth", scenario["terminal_growth"]),
            "terminal_roic": self._finite("terminal_roic", scenario["terminal_roic"]),
            "bridge_adjustment": self._finite(
                "bridge_adjustment", bridge["bridge_adjustment"]
            ),
            "issued_shares": self._finite("issued_shares", bridge["issued_shares"]),
            "operating_cash_required": self._finite(
                "operating_cash_required", bridge["operating_cash_required"]
            ),
        }
        if values["revenue"] <= 0:
            raise ValueError("base_revenue_must_be_positive")
        if values["revenue_growth"] <= -1:
            raise ValueError("revenue_growth_must_be_greater_than_minus_one")
        if not -1 < values["base_nopat_margin"] < 1 or not -1 < values[
            "target_nopat_margin"
        ] < 1:
            raise ValueError("nopat_margin_must_be_between_minus_one_and_one")
        if values["incremental_capital_turnover"] <= 0:
            raise ValueError("incremental_capital_turnover_must_be_positive")
        if values["wacc"] <= -1:
            raise ValueError("wacc_must_be_greater_than_minus_one")
        if values["terminal_growth"] < 0:
            raise ValueError("terminal_growth_must_be_non_negative")
        if values["terminal_growth"] >= values["wacc"]:
            raise ValueError("terminal_growth_must_be_less_than_wacc")
        if values["terminal_roic"] <= values["terminal_growth"]:
            raise ValueError("terminal_roic_must_exceed_terminal_growth")
        if values["operating_cash_required"] < 0:
            raise ValueError("operating_cash_required_must_be_non_negative")
        if values["issued_shares"] <= 0:
            raise ValueError("issued_shares_must_be_positive")
        return values

    def _one_row(self, value: Any, columns: list[str], name: str) -> dict[str, Any]:
        rows = self._rows(value, columns, name, 1)
        if len(rows) != 1:
            raise ValueError(f"{name}_must_have_exactly_one_row")
        return rows[0]

    def _rows(
        self, value: Any, columns: list[str], name: str, maximum_rows: int
    ) -> list[dict[str, Any]]:
        if self._pandas is None or not isinstance(value, self._pandas.DataFrame):
            raise TypeError(f"{name}_must_be_a_dataframe")
        if len(value) < 1:
            raise ValueError(f"{name}_must_have_at_least_one_row")
        if len(value) > maximum_rows:
            raise ValueError(f"{name}_accepts_at_most_{maximum_rows}_rows")
        if value.columns.has_duplicates:
            raise ValueError(f"{name}_columns_must_be_unique")
        missing = [column for column in columns if column not in value.columns]
        if missing:
            raise ValueError(f"{name}_missing_columns:{','.join(missing)}")
        return value[columns].to_dict(orient="records")

    def _finite(self, name: str, value: Any) -> float:
        if isinstance(value, bool):
            raise ValueError(f"non_finite_input:{name}")
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"non_finite_input:{name}") from None
        if not math.isfinite(number):
            raise ValueError(f"non_finite_input:{name}")
        return number

    def _validate_years(self, forecast_years: int) -> None:
        if isinstance(forecast_years, bool) or not isinstance(forecast_years, int):
            raise ValueError("forecast_years_must_be_between_1_and_20")
        if not 1 <= forecast_years <= 20:
            raise ValueError("forecast_years_must_be_between_1_and_20")

    def _solver_frame(
        self,
        status: str,
        implied_value: float,
        lower_bound: float,
        upper_bound: float,
        target: float,
        diagnostic: str,
    ) -> Any:
        return self._frame(
            [
                {
                    "formula_version": "fcff-scenarios-v1",
                    "parameter": "revenue_growth",
                    "status": status,
                    "implied_value": implied_value,
                    "lower_bound": lower_bound,
                    "upper_bound": upper_bound,
                    "target_enterprise_value": target,
                    "unit": "ratio",
                    "diagnostic": diagnostic,
                }
            ]
        )

    def _frame(self, rows: list[dict[str, Any]]) -> Any:
        if self._pandas is None:
            return rows
        return self._pandas.DataFrame(rows)
