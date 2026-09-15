import json

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

START, END = "20181201", "20251231"
MEASURE = "market.adjusted_close"          # platform index level (price index -> level)
CODES = ["000300.SH", "000852.SH", "000905.SH"]
ROLE = {"000300.SH": "A", "000852.SH": "B", "000905.SH": "C"}
LABEL = {"000300.SH": "A = 000300.SH", "000852.SH": "B = 000852.SH", "000905.SH": "C = 000905.SH"}
WIN = 12

grid = pd.period_range("2018-12", "2025-12", freq="M")           # 85 months
analysis = grid[grid >= pd.Period("2019-01", freq="M")]           # 84 months
pre_idx = analysis[analysis <= pd.Period("2022-12", freq="M")]
post_idx = analysis[analysis >= pd.Period("2023-01", freq="M")]

def finite_or_none(v):
    if v is None:
        return None
    v = float(v)
    return v if np.isfinite(v) else None

def _stat(res):
    try:
        return float(res.statistic)
    except AttributeError:
        return float(res[0])

# ---- month-end levels (no filling of any kind) -----------------------------
levels = {}
for code in CODES:
    df = data.series("index", code, start=START, end=END, measure=MEASURE,
                     frequency="monthly", transform="level", partial_period="exclude")
    if df is None or len(df) == 0:
        raise RuntimeError("no monthly level series for %s" % code)
    idx = pd.to_datetime(df["date"]).dt.to_period("M")
    levels[code] = pd.Series(np.asarray(df["value"], dtype=float), index=idx).reindex(grid)

print("measure=%s | grid=%d months (2018-12..2025-12) | analysis=%d months (2019-01..2025-12)"
      % (MEASURE, len(grid), len(analysis)))

# ---- monthly returns: only adjacent, both-present months -------------------
rets = {}
for code in CODES:
    lv = levels[code]
    rets[code] = (lv / lv.shift(1) - 1.0).where(lv.notna() & lv.shift(1).notna())

rows_assets, audit_assets = [], []
for code in CODES:
    present = levels[code].notna()
    r = rets[code].reindex(analysis).dropna()
    n_price = int(present.sum()); n_missing = int(len(grid) - n_price); n_ret = int(len(r))
    vol = float(r.std(ddof=1) * np.sqrt(12)) if n_ret > 1 else float("nan")
    q = np.quantile(r.to_numpy(float), [0.25, 0.50, 0.75]) if n_ret > 0 else (np.nan, np.nan, np.nan)
    gaps = [str(p) for p in grid[~present]]
    rows_assets.append({"asset": "%s (%s)" % (ROLE[code], code), "measure": MEASURE,
                        "price_rows": n_price, "missing_months": n_missing, "valid_returns": n_ret,
                        "annual_vol": vol, "q25": float(q[0]), "q50": float(q[1]), "q75": float(q[2]),
                        "missing_list": ",".join(gaps) if gaps else "-"})
    audit_assets.append({"asset": code, "price_rows": n_price, "missing_months": n_missing,
                         "valid_returns": n_ret, "annual_vol": finite_or_none(vol),
                         "q25": finite_or_none(q[0]), "q50": finite_or_none(q[1]),
                         "q75": finite_or_none(q[2])})

print("\n[Asset sample facts] monthly returns are decimal fractions (0.01 = 1%); no rounding applied")
print(pd.DataFrame(rows_assets).to_string(index=False, float_format=lambda v: "%.6f" % v))

# ---- paired complete-sample analysis ---------------------------------------
def pair_block(xr, yr, months):
    xs, ys = xr.reindex(months), yr.reindex(months)
    ok = xs.notna() & ys.notna()
    x = xs[ok].to_numpy(float)
    y = ys[ok].to_numpy(float)
    n = int(len(x))
    if n < 3:
        return {"n": n, "pearson": None, "spearman": None, "alpha_monthly": None, "beta": None}
    fit = sm.OLS(y, sm.add_constant(x)).fit()
    return {"n": n, "pearson": _stat(stats.pearsonr(x, y)), "spearman": _stat(stats.spearmanr(x, y)),
            "alpha_monthly": float(fit.params[0]), "beta": float(fit.params[1])}

PERIODS = [("all", analysis), ("pre2023", pre_idx), ("post2023", post_idx)]
rows_pairs, audit_pairs = [], []
for xcode, ycode in [("000300.SH", "000852.SH"), ("000300.SH", "000905.SH")]:
    for pname, months in PERIODS:
        b = pair_block(rets[xcode], rets[ycode], months)
        rows_pairs.append({"pair": "%s / %s" % (xcode, ycode), "y": ROLE[ycode], "period": pname,
                           "n": b["n"], "pearson": b["pearson"], "spearman": b["spearman"],
                           "alpha_monthly": b["alpha_monthly"], "beta": b["beta"]})
        audit_pairs.append({"pair": "%s/%s" % (xcode, ycode), "period": pname, "n": b["n"],
                            "pearson": finite_or_none(b["pearson"]),
                            "spearman": finite_or_none(b["spearman"]),
                            "alpha_monthly": finite_or_none(b["alpha_monthly"]),
                            "beta": finite_or_none(b["beta"])})

print("\n[Paired complete-sample stats] y = B or C, x = A; alpha is per month (decimal); no rounding applied")
print(pd.DataFrame(rows_pairs).to_string(index=False, float_format=lambda v: "%.6f" % v))

# ---- rolling 12-month correlation, gaps preserved --------------------------
def rolling_corr(x, y, win=WIN):
    out = pd.Series(np.nan, index=grid, dtype=float)
    for i in range(win, len(grid)):
        wx, wy = x.iloc[i - win + 1:i + 1], y.iloc[i - win + 1:i + 1]
        if wx.notna().all() and wy.notna().all():
            out.iloc[i] = float(np.corrcoef(wx.to_numpy(float), wy.to_numpy(float))[0, 1])
    return out

rc = {"A-B": rolling_corr(rets["000300.SH"], rets["000852.SH"]),
      "A-C": rolling_corr(rets["000300.SH"], rets["000905.SH"])}
for k, s in rc.items():
    v = s.dropna()
    print("[Rolling 12M corr %s] valid windows=%d span=%s..%s min=%.6f max=%.6f mean=%.6f"
          % (k, len(v), v.index.min() if len(v) else "-", v.index.max() if len(v) else "-",
             v.min() if len(v) else float("nan"), v.max() if len(v) else float("nan"),
             v.mean() if len(v) else float("nan")))

# ---- figures: Matplotlib, English labels, NaN breaks the line --------------
x_dates = grid.to_timestamp(how="end")
base_month = next(p for p in grid if all(levels[c].notna().loc[p] for c in CODES))
split = pd.Timestamp("2023-01-31")

fig1, ax1 = plt.subplots(figsize=(11, 5.5))
for code in CODES:
    norm = levels[code] / levels[code].loc[base_month] * 100.0
    ax1.plot(x_dates, norm.to_numpy(float), lw=1.6, label=LABEL[code])
ax1.axvline(split, color="0.35", ls="--", lw=1.0)
ax1.set_title("Month-end index level rebased to 100 at %s (synthetic demo data, CNY)" % base_month)
ax1.set_xlabel("Month end"); ax1.set_ylabel("Rebased level (start = 100)")
ax1.grid(alpha=0.3); ax1.legend(loc="upper left")
ax1.text(0.01, 0.02, "Line gaps = missing month-end observation (never filled); dashed line = 2023-01 split",
         transform=ax1.transAxes, fontsize=8, color="0.3")
fig1.tight_layout()

fig2, ax2 = plt.subplots(figsize=(11, 5.0))
for k, s in rc.items():
    ax2.plot(s.index.to_timestamp(how="end"), s.to_numpy(float), lw=1.6,
             label="Rolling 12M corr %s" % k)
ax2.axhline(0.0, color="0.6", lw=0.9)
ax2.axvline(split, color="0.35", ls="--", lw=1.0)
ax2.set_ylim(-1.05, 1.05)
ax2.set_title("Rolling correlation of monthly returns (window = 12 consecutive calendar months)")
ax2.set_xlabel("Window end (month end)"); ax2.set_ylabel("Pearson correlation")
ax2.grid(alpha=0.3); ax2.legend(loc="lower left")
ax2.text(0.01, 0.02, "Defined only when all 12 paired monthly observations are complete; "
                     "gaps = missing month or insufficient window",
         transform=ax2.transAxes, fontsize=8, color="0.3")
fig2.tight_layout()

print("\n[Reading note] A 12M window means 12 consecutive calendar months with 12 complete paired "
      "returns; a cleaned 12-return subset covering fewer months is never called 12 months.")

print("AUDIT_JSON=" + json.dumps({"assets": audit_assets, "pairs": audit_pairs}, ensure_ascii=False))