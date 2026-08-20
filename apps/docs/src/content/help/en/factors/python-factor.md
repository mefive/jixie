# Write a Factor in Python

New custom Factors default to Python `py-v1`. The Python Factor SDK supports stock cross-sections, single-asset time series, and cross-asset Panels. The selected research kind determines the entry point, available fields, and report method.

## Create a Python Factor

1. Open **Factor Research**.
2. Select **New** on the left.
3. Choose **Stock cross-sectional Factor**, **ETF time-series Factor**, or **Panel cross-sectional Factor**.
4. Enter a display name and the Factor key, which is fixed after creation.
5. Confirm that the editor header shows **Python · py-v1**.
6. Edit directly, or tell the Agent the formula, direction, window, and missing-value rule.

The editor provides Python types and Factor field completion. Completion confirms availability, not suitability for your study.

![Python Factor editor and field completion](/docs/images/help/zh/factors/python-factor-01.png)

## Cross-sectional form

A cross-sectional Factor returns one number or `None` for each stock at each comparison date.

```python
from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="Earnings yield")

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return 1 / bar.pe_ttm if bar.pe_ttm is not None and bar.pe_ttm > 0 else None
```

- `bar.pe_ttm` is the P/E TTM available for the current stock at the historical point in time.
- A number participates in that period's ranking.
- `None` means no valid value and is excluded from that period's ranking.
- Do not replace missing values with `0`; zero is a real score.

Use `ctx.history(periods, field)` when price or financial history is required, and declare a sufficient `window` and `min_coverage`.

## Time-series form

A time-series Factor calculates a signal from one asset's own history.

```python
from jixie import Factor, AssetFactorContext

factor = Factor.time_series(
    name="ETF 20-day trend",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income", "commodity"],
    window=21,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 20)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
```

`inputs` and `target_asset_classes` are part of the definition. Code can read only declared inputs, and should return `None` when history is insufficient.

## Panel form

A Panel Factor uses `Factor.panel(...)` and emits a cross-sectionally comparable score for each asset in a fixed cross-asset pool at each decision date. Its `compute` still reads one asset's history, while the report compares scores at common month-ends.

Scores must have comparable scale and direction across assets. Raw price levels are usually unsuitable; use returns, volatility-adjusted values, or another explicit normalization.

## Diagnose, analyze, and publish

1. Wait until code is saved.
2. Resolve editor errors in fields, types, and return values.
3. Configure dates, frequency, universe or asset pool, horizon, and research card.
4. Select **Run analysis**, then inspect logs and the full report.
5. Rerun after source changes; an old report still describes old code.
6. Publish only from an approved report matching the current name, key, source, research kind, and protocol.

A published Factor freezes its definition. Copy it into a new draft for further experiments.

## TypeScript compatibility

Existing TypeScript Factors remain readable and runnable. Python is the default for new drafts and does not rewrite historical definitions. Both languages follow the same research protocol, but their functions and null syntax differ; code is not interchangeable.

## Common questions

### `Factor.cross_sectional` does not match the research kind

The code entry point must match the kind chosen at creation. Use `Factor.time_series` for time series and `Factor.panel` for Panels.

### The Python runs. Why can it not be published?

Executable code is only the first gate. Publication also requires an approved report matching the current definition and any required research card, Holdout, or other gates.

## Related articles

- [Create and edit a custom factor](/docs/help/factors/create-custom-factor)
- [Read robust cross-sectional inference](/docs/help/factors/robust-inference)
- [Publish a Factor and use it in a strategy](/docs/help/factors/publish-factor)

