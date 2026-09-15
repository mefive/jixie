import json, math
import numpy as np
import pandas as pd
import scipy.stats as st
import statsmodels.api as sm
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Synthetic isolated library: A, B, C are only month-end price tags, all CNY.
START, END = "20181231", "20251231"
CODES = ["000300.SH", "000852.SH", "000905.SH"]
A_CODE = "000300.SH"
BASE_M = pd.Period("2018-12", freq="M")      # warm-up month: base of the first return
FIRST_RET = pd.Period("2019-01", freq="M")   # analysis window start
LAST_M = pd.Period("2025-12", freq="M")
PRE_END = pd.Period("2022-12", freq="M")
POST_START = pd.Period("2023-01", freq="M")

# ---- 1. load month-end levels ----
series, raw_rows = {}, {}
for c in CODES:
    df = data.series("index", c, start=START, end=END, measure="market.adjusted_close",
                     frequency="monthly", transform="level", partial_period="exclude")
    raw_rows[c] = int(len(df))
    s = pd.Series(pd.to_numeric(df["value"], errors="coerce").to_numpy(dtype=float),
                  index=pd.to_datetime(df["date"]).dt.to_period("M"))
    series[c] = s[~s.index.duplicated(keep="last")].sort_index()

# ---- 2. complete natural-month grid; missing months stay NaN ----
grid = pd.period_range(BASE_M, LAST_M, freq="M")
aligned = pd.DataFrame({c: series[c].reindex(grid) for c in CODES})

# month-over-month returns only between ADJACENT grid months (no fill, no gap-jumping)
prev_present = aligned.shift(1).notna()
rets_all = aligned.diff().where(prev_present)
rets = rets_all[(rets_all.index >= FIRST_RET) & (rets_all.index <= LAST_M)]

# ---- 3. per-asset descriptive statistics ----
asset_rows = []
for c in CODES:
    r = rets[c].dropna()
    if len(r):
        q25, q50, q75 = (float(r.quantile(0.25)), float(r.quantile(0.50)), float(r.quantile(0.75)))
    else:
        q25 = q50 = q75 = float("nan")
    asset_rows.append({
        "asset": c,
        "price_rows": int(len(series[c])),
        "data_rows_raw": raw_rows[c],
        "missing_months": int(aligned[c].isna().sum()),
        "valid_returns": int(len(r)),
        "annual_vol": float(r.std(ddof=1) * np.sqrt(12)) if len(r) > 1 else float("nan"),
        "q25": q25, "q50": q50, "q75": q75,
    })
asset_tbl = pd.DataFrame(asset_rows)

# ---- 4. pairwise complete-sample analysis vs A ----
masks = {
    "all": pd.Series(True, index=rets.index),
    "pre2023": pd.Series(rets.index <= PRE_END, index=rets.index),
    "post2023": pd.Series(rets.index >= POST_START, index=rets.index),
}

def pair_stats(xc, yc, period):
    sub = pd.concat([rets[xc].rename("x"), rets[yc].rename("y")], axis=1)
    sub = sub[masks[period]].dropna()
    n = int(len(sub))
    out = {"pair": xc + "/" + yc, "period": period, "n": n, "pearson": float("nan"),
           "spearman": float("nan"), "alpha_monthly": float("nan"), "beta": float("nan")}
    if n >= 3:
        x = sub["x"].to_numpy(float); y = sub["y"].to_numpy(float)
        out["pearson"] = float(st.pearsonr(x, y).statistic)
        out["spearman"] = float(st.spearmanr(x, y).statistic)
        fit = sm.OLS(y, sm.add_constant(x)).fit()
        out["alpha_monthly"] = float(fit.params[0])
        out["beta"] = float(fit.params[1])
    return out

pair_rows = []
for yc in CODES:
    if yc == A_CODE:
        continue
    for period in ["all", "pre2023", "post2023"]:
        pair_rows.append(pair_stats(A_CODE, yc, period))
pair_tbl = pd.DataFrame(pair_rows)

# ---- 5. rolling 12-month correlation: 12 consecutive complete grid months ----
def rolling_corr(xc, yc, window=12):
    x, y = rets[xc], rets[yc]
    idx = x.index
    vals = []
    for i in range(len(idx)):
        if i + 1 < window:
            vals.append(float("nan")); continue
        xs = x.iloc[i - window + 1:i + 1]
        ys = y.iloc[i - window + 1:i + 1]
        m = xs.notna() & ys.notna()
        if int(m.sum()) == window and xs[m].std(ddof=1) > 0 and ys[m].std(ddof=1) > 0:
            vals.append(float(np.corrcoef(xs[m].to_numpy(float), ys[m].to_numpy(float))[0, 1]))
        else:
            vals.append(float("nan"))
    return pd.Series(vals, index=idx)

roll = pd.DataFrame({A_CODE + "/" + yc: rolling_corr(A_CODE, yc) for yc in CODES if yc != A_CODE})

# ---- 6. normalised levels from the analysis start ----
norm = aligned[aligned.index >= FIRST_RET]
norm_df = pd.DataFrame(index=norm.index)
for c in CODES:
    v = norm[c].dropna()
    norm_df[c] = norm[c] / float(v.iloc[0]) * 100.0 if len(v) else np.nan

# ---- 7. text diagnostics and tables ----
missing_detail = {c: [str(p) for p in aligned.index[aligned[c].isna()]] for c in CODES}
print("SYNTHETIC ISOLATED SAMPLE - not real market data (A/B/C are month-end price tags, CNY).")
print("grid months:", len(grid), "| price_rows = months with an observed month-end level | missing_months = NaN grid months")
print("returns 2019-01..2025-12 use adjacent grid months only: no forward fill, no zero fill, no cross-gap compounding.")
print("annual_vol = sample std (ddof=1) x sqrt(12); quantiles = linear; OLS with intercept (y = B or C, x = A).")
print("rolling corr needs 12 CONSECUTIVE grid months AND 12 complete pairwise returns; a 12-row cleaned window may span >12 months, so those windows are excluded.")
print("missing grid months:", json.dumps(missing_detail, ensure_ascii=False))
print("valid rolling windows per pair:", roll.notna().sum().to_dict())
print()
print("=== asset statistics (asset / price_rows / missing_months / valid_returns / annual_vol / q25 / q50 / q75) ===")
print(asset_tbl.to_string(index=False))
print()
print("=== pairwise complete-sample regressions (y = B or C, x = A) ===")
print(pair_tbl.to_string(index=False))
print()

# ---- 8. figures: Matplotlib (Agg) + charts.* rendering ----
fig, axes = plt.subplots(2, 1, figsize=(11, 8.5))
ax = axes[0]
xd = norm_df.index.to_timestamp()
for c in CODES:
    ax.plot(xd, norm_df[c].to_numpy(float), label=c, linewidth=1.3)
ax.set_title("Month-end price levels, base 2019-01 = 100 (line breaks = missing months)")
ax.set_ylabel("Level (2019-01 = 100)")
ax.grid(alpha=0.3); ax.legend(loc="best", fontsize=9)

ax = axes[1]
xd2 = roll.index.to_timestamp()
for col in roll.columns:
    ax.plot(xd2, roll[col].to_numpy(float), label=col, linewidth=1.3)
ax.axhline(0.0, color="black", linewidth=0.8)
ax.set_title("Rolling 12-month correlation (12 complete consecutive months required; gaps = window incomplete)")
ax.set_ylabel("Correlation"); ax.set_xlabel("Window end month")
ax.grid(alpha=0.3); ax.legend(loc="best", fontsize=9)
fig.tight_layout()
FIG = fig  # kept open: the cell runtime has no display() hook, so the same data is also rendered via charts.*
try:
    fig.savefig("/tmp/embedded_diversification_monthly.png", dpi=130, bbox_inches="tight")
    print("Matplotlib (Agg) figure saved to /tmp/embedded_diversification_monthly.png")
except Exception as e:
    print("savefig unavailable:", e)

def _render(frame, cols, title):
    try:
        charts.line(frame, x="month", y=cols, title=title)
        return
    except Exception as e1:
        try:
            clean = frame.copy()
            for k in cols:
                clean[k] = [None if pd.isna(v) else float(v) for v in clean[k]]
            charts.line(clean, x="month", y=cols, title=title)
        except Exception as e2:
            print("chart unavailable:", title, "|", e1, "|", e2)

pf = norm_df.reset_index()
pf.columns = ["month"] + CODES
pf["month"] = pf["month"].astype(str)
_render(pf, CODES, "Month-end price levels, base 2019-01 = 100 (gaps = missing months)")

cf = roll.reset_index()
cf.columns = ["month"] + list(roll.columns)
cf["month"] = cf["month"].astype(str)
_render(cf, list(roll.columns), "Rolling 12-month correlation (12 complete consecutive months required)")

# ---- 9. raw-precision audit line (no pre-rounding) ----
def num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except Exception:
        return None
    return f if math.isfinite(f) else None

audit = {
    "assets": [{"asset": r["asset"], "price_rows": int(r["price_rows"]),
                "missing_months": int(r["missing_months"]), "valid_returns": int(r["valid_returns"]),
                "annual_vol": num(r["annual_vol"]), "q25": num(r["q25"]),
                "q50": num(r["q50"]), "q75": num(r["q75"])} for r in asset_rows],
    "pairs": [{"pair": r["pair"], "period": r["period"], "n": int(r["n"]),
               "pearson": num(r["pearson"]), "spearman": num(r["spearman"]),
               "alpha_monthly": num(r["alpha_monthly"]), "beta": num(r["beta"])} for r in pair_rows],
}
print("AUDIT_JSON=" + json.dumps(audit, ensure_ascii=False, allow_nan=False))
