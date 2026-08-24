# Load US Treasury yield curves

Research Python can load governed US Treasury nominal- and real-yield tenor series. A `data.yield_curve()` call must state the curve, tenor, and dates. Do not substitute one tenor for another or interchange nominal and real yields.

## Choose a curve and tenor

- `us_treasury_nominal`: US Treasury nominal par yields.
- `us_treasury_real`: US Treasury real par yields.

The nominal curve supports 1M, 2M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, and 30Y. The real curve currently supports 5Y, 7Y, 10Y, 20Y, and 30Y. A real yield is not an arbitrary inflation number subtracted from a nominal yield.

## Load yield levels

1. State the curve, tenor, sample range, and frequency in the research question or a Markdown Cell.
2. Add or open a Python Cell.
3. Enter `data.yield_curve()` and set `curve`, `tenor`, `start`, and `end`.
4. Use `frequency="daily"` for daily observations or `frequency="monthly"` for completed monthly observations.
5. Use `transform="level"` for yield levels.
6. Run the Cell and inspect the returned `date` and `value` columns.

```python
real_10y = data.yield_curve(
    "us_treasury_real",
    tenor="10Y",
    start="20150101",
    end="20251231",
    frequency="monthly",
    transform="level",
)
real_10y
```

`value` is measured in percent. For example, `1.75` means 1.75%, not 0.0175.

![Yield-curve data and returned columns](/docs/images/help/zh/research/yield-curves-01.png)

## Load percentage-point changes

Use `transform="difference"` for the percentage-point change between consecutive observations. A move from 4.0% to 4.2% is `0.2` percentage points.

```python
nominal_10y_change = data.yield_curve(
    "us_treasury_nominal",
    tenor="10Y",
    start="20200101",
    end="20251231",
    frequency="monthly",
    transform="difference",
)
```

A percentage-point change is not a bond holding-period return. It excludes coupon income, duration, and price return and cannot replace a total-return series.

## Monthly and partial periods

`partial_period="exclude"` is the default and removes an unfinished monthly period. Use `include` only when the incomplete month is intentional, and disclose that the last value can still change.

## Align with China-market data

US yields are US-close observations. When comparing them with A-shares, CNY ETFs, or domestic futures, do not assume that the same calendar date represents simultaneously tradable information. Explicitly lag the US series in code or disclose the time-zone and availability convention in Markdown.

## Inspect a real run

Check sample dates, missing values, and observation count before correlation, regression, or hypothesis tests. The screenshot shows a real yield study in the fixed runtime. A significant sample result remains an association, not a causal conclusion or trading signal.

![Statistical output from a yield study](/docs/images/help/zh/research/yield-curves-02.png)

## Common questions

### A real-yield tenor does not run

The real curve does not currently cover every short tenor. Use a supported editor suggestion instead of silently substituting a nominal or neighboring tenor.

### The first difference is missing

`difference` requires a previous observation. The first returned observation has no earlier value and may therefore be missing.

## Related articles

- [Use the research data catalog](/docs/help/research/data-catalog)
- [Use the Research Python runtime](/docs/help/research/python-runtime)
- [How to read a time-series relationship study](/docs/help/basics/time-series-relationships)
