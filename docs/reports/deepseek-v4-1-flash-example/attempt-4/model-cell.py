import json
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ASSETS = [("A", "000300.SH"), ("B", "000852.SH"), ("C", "000905.SH")]
PAIRS = [("000300.SH/000852.SH", "B"), ("000300.SH/000905.SH", "C")]
GRID_START, GRID_END = "2018-12", "2025-12"
ANALYSIS_START = "2019-01"
PERIODS = [("all", "2019-01", "2025-12"),
           ("pre2023", "2019-01", "2022-12"),
           ("post2023", "2023-01", "2025-12")]
ROLL_W = 12
ANN = float(np.sqrt(12.0))
CODE = dict(ASSETS)
P = lambda s: pd.Period(s, freq="M")

grid = pd.period_range(GRID_START, GRID_END, freq="M")
prices = pd.DataFrame(index=grid, dtype="float64")
load_log = []
for label, code in ASSETS:
    try:
        d = data.series("index", code, start="20181201", end="20251231",
                        measure="market.adjusted_close", frequency="monthly",
                        transform="level", partial_period="exclude").copy()
    except Exception as exc:
        load_log.append("LOAD_FAIL %s %s: %r" % (label, code, exc))
        prices[label] = np.nan
        continue
    d["date"] = pd.to_datetime(d["date"])
    s = pd.Series(d["value"].to_numpy(dtype="float64"),
                  index=pd.PeriodIndex(d["date"], freq="M"))
    s = s[~s.index.duplicated(keep="last")].sort_index()
    prices[label] = s.reindex(grid)
    load_log.append("LOAD_OK %s %s rows=%d first=%s last=%s"
                    % (label, code, len(d), str(d["date"].min().date()), str(d["date"].max().date())))

# ---- complete natural-month grid; shift(1) is exactly one calendar month, so a gap
# ---- can never be turned into a one-month return
prev = prices.shift(1)
rets = (prices / prev - 1.0).mask(prices.isna() | prev.isna())

# ---------------- per-asset statistics ----------------
asset_rows, audit_assets = [], []
for label, code in ASSETS:
    p = prices[label]
    v = rets[label][rets[label].index >= P(ANALYSIS_START)].dropna().to_numpy()
    n_px, n_miss, n_ret = int(p.notna().sum()), int(p.isna().sum()), int(v.size)
    vol = float(np.std(v, ddof=1) * ANN) if v.size >= 2 else None
    if v.size >= 1:
        q = np.percentile(v, [25, 50, 75], method="linear")
        q25, q50, q75 = float(q[0]), float(q[1]), float(q[2])
    else:
        q25 = q50 = q75 = None
    asset_rows.append({"asset": label, "code": code, "price_rows": n_px, "missing_months": n_miss,
                       "valid_returns": n_ret, "annual_vol": vol, "q25": q25, "q50": q50, "q75": q75})
    audit_assets.append({"asset": code, "price_rows": n_px, "missing_months": n_miss,
                         "valid_returns": n_ret, "annual_vol": vol, "q25": q25, "q50": q50, "q75": q75})
asset_tbl = pd.DataFrame(asset_rows)

# ---------------- pairwise statistics (pairwise-complete only) ----------------
pair_rows, audit_pairs, pair_sets = [], [], {}
for pair_name, label in PAIRS:
    both = pd.concat([rets["A"].rename("A"), rets[label].rename(label)], axis=1)
    for period, s0, s1 in PERIODS:
        w = both[(both.index >= P(s0)) & (both.index <= P(s1))].dropna()
        n = int(len(w))
        if n >= 3:
            x, y = w["A"].to_numpy(), w[label].to_numpy()
            pear = float(stats.pearsonr(x, y).statistic)
            spear = float(stats.spearmanr(x, y).statistic)
            fit = sm.OLS(y, sm.add_constant(x)).fit()
            alpha, beta = float(fit.params[0]), float(fit.params[1])
        else:
            pear = spear = alpha = beta = None
        pair_rows.append({"pair": pair_name, "period": period, "n": n, "pearson": pear,
                          "spearman": spear, "alpha_monthly": alpha, "beta": beta})
        audit_pairs.append({"pair": pair_name, "period": period, "n": n, "pearson": pear,
                            "spearman": spear, "alpha_monthly": alpha, "beta": beta})
pair_tbl = pd.DataFrame(pair_rows)

# ---------------- rolling correlation: 12 consecutive natural months, 12 complete pairs ----------------
roll = {}
for pair_name, label in PAIRS:
    roll[pair_name] = rets["A"].rolling(ROLL_W, min_periods=ROLL_W).corr(rets[label])

x_axis = grid.to_timestamp(how="end")
norm = pd.DataFrame({"date": x_axis})
for label, code in ASSETS:
    norm["%s = %s" % (label, code)] = (prices[label] / prices[label].iloc[0] * 100.0).to_numpy()
rollf = pd.DataFrame({"date": x_axis})
for pair_name, label in PAIRS:
    rollf["%s vs %s" % (CODE["A"], CODE[label])] = roll[pair_name].to_numpy()

# Matplotlib figures (Agg, English labels only: no CJK font in this runtime)
fig1, ax1 = plt.subplots(figsize=(10, 5))
for label, code in ASSETS:
    ax1.plot(x_axis, norm["%s = %s" % (label, code)].to_numpy(), linewidth=1.6,
             label="%s = %s" % (label, code))
ax1.set_title("Month-end index level rebased to 100 at 2018-12 (line breaks = missing month)")
ax1.set_xlabel("Month end"); ax1.set_ylabel("Index, 2018-12 = 100")
ax1.grid(alpha=0.3); ax1.legend(); plt.tight_layout(); plt.show()

fig2, ax2 = plt.subplots(figsize=(10, 5))
for pair_name, label in PAIRS:
    ax2.plot(x_axis, rollf["%s vs %s" % (CODE["A"], CODE[label])].to_numpy(), linewidth=1.6,
             label="%s vs %s" % (CODE["A"], CODE[label]))
ax2.axhline(0.0, color="grey", linewidth=0.8, linestyle="--")
ax2.set_title("Rolling 12-month correlation of monthly returns (breaks = incomplete window)")
ax2.set_xlabel("Window end (month)"); ax2.set_ylabel("Pearson correlation")
ax2.grid(alpha=0.3); ax2.legend(); plt.tight_layout(); plt.show()

# native charts so the same two figures are actually rendered in the card (None = gap, not carried over)
norm_native = norm.astype(object).where(norm.notna(), None)
roll_native = rollf.astype(object).where(rollf.notna(), None)
charts.line(norm_native, x="date", y=[c for c in norm.columns if c != "date"],
            title="Synthetic month-end levels rebased to 100 at 2018-12 (gaps = missing months)")
charts.line(roll_native, x="date", y=[c for c in rollf.columns if c != "date"],
            title="Rolling 12-month return correlation, 12 complete pairs required")

print("== SAMPLE AND CONVENTIONS ==")
print("aligned natural-month grid %s..%s = %d months; 2018-12 is a return warm-up only; analysis window %s..2025-12"
      % (GRID_START, GRID_END, len(grid), ANALYSIS_START))
print("monthly simple returns of month-end index LEVEL (CNY, synthetic codes in this library). Missing months are kept as "
      "NaN: no forward fill, no zero fill, and a change across a gap is never booked as a one-month return. "
      "annual_vol = sample std(ddof=1) x sqrt(12); quantiles use linear interpolation; pair stats use pairwise-complete "
      "observations only; rolling correlation requires 12 consecutive natural months with 12 complete pairs.")
for line in load_log:
    print(line)
print("")
print("== PER-ASSET (monthly returns, 2019-01..2025-12) ==")
print(asset_tbl.round(6).to_string(index=False))
print("")
print("== PAIRS (y = B or C, x = A, OLS with intercept) ==")
print(pair_tbl.round(6).to_string(index=False))
print("")
print("== ROLLING 12M CORRELATION COVERAGE (valid windows only; gaps stay blank) ==")
for pair_name, label in PAIRS:
    r = roll[pair_name].dropna()
    print("%s : valid_windows=%d first=%s last=%s min=%.6f max=%.6f"
          % (pair_name, len(r), str(r.index.min()), str(r.index.max()), float(r.min()), float(r.max())))
print("")
print("== LIMITS ==")
print("About 78-84 usable monthly returns is a short sample; the pre/post-2023 split is a single arbitrary cut with no "
      "formal regime or break test, and the pre-2023 window has ~48 observations, so sub-sample correlations are noisy. "
      "Correlation says nothing about causation, drawdown co-movement or tradability. These are price levels, so income "
      "and any financing/carry are excluded.")
print("AUDIT_JSON=" + json.dumps({"assets": audit_assets, "pairs": audit_pairs}, ensure_ascii=False))
