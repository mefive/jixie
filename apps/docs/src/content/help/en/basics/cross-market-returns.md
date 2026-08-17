# How to compare China, Hong Kong, and US market returns

The workbench registers three research benchmarks: CSI 300, Hang Seng, and S&P 500. They are **price indices** used to
explain market movements. They exclude dividend reinvestment and cannot be traded at index points. Their separate
China-listed tradable proxies are `510300.SH`, `159920.SZ`, and `513500.SH`. ETF fees, tracking error, QDII NAV timing,
suspensions, and trading costs belong to the proxy layer.

## Choose local-currency or CNY returns

- Local return answers how the underlying market moved in its own currency: CNY for CSI 300, HKD for Hang Seng, and USD
  for S&P 500.
- CNY return answers how the index level changed after market and currency effects for a CNY investor. It is still not the
  realized ETF return.

For local index level $P_t$ and CNY per unit of local currency $Q_t$:

$$
1+R_{CNY,t}=(1+R_{local,t})(1+R_{FX,t}),\qquad
R_{FX,t}=\frac{Q_t}{Q_{t-1}}-1
$$

The USD index uses `USDCNH.FXCM`. There is no registered usable direct `HKDCNH` quote, so the HKD conversion is explicit:

$$
Q_{HKD/CNH,t}=\frac{USDCNH_t}{USDHKD_t}
$$

The system never presents this derived series as a direct quote.

Each benchmark `availableDate` uses the latest FX bar observable at that time. If several global FX bars become available
on the same post-holiday China session, the latest source trade date wins deterministically. A quote older than seven
calendar days is rejected and reported as a data gap instead of being carried forward indefinitely.

## Why dates appear one session apart

The common information clock is the China close:

- CSI 300 is usable after its local close, so `availableDate` equals its China trade date.
- Hang Seng closes after Shanghai and S&P 500 closes later still. Both are usable on the **first strictly later SSE
  session**.
- FXCM daily bars use GMT dates and are also gated to the first strictly later SSE session.

Do not join the three closes by the same calendar date. Research protocols align by `availableDate`. A holiday in only one
market remains a real missing observation; no future value or weekend forward-fill creates a new observation.

## Example questions

- “Compare monthly-return correlations among CSI 300, Hang Seng, and S&P 500 since 2015 in CNY.”
- “How different are Hang Seng local and CNY monthly returns? Show the HKD FX return separately.”
- “Study US 10-year real-yield changes versus S&P 500 CNY monthly returns while controlling for US CPI.”
- “Run a monthly Panel trend study with tradable proxies 510300, 159920, and 513500, and explain how they differ from the indices.”

## Limits on conclusions

- Price-index return is not dividend-inclusive total return; long-horizon comparisons may understate dividend contribution.
- A CNY index return is a research conversion and excludes QDII fees, tracking error, and subscription/redemption effects.
- Contemporaneous correlation is not causality. The interaction term in asset and FX returns must not be lost in a simple sum.
- Sample loss from different market holidays is real and should not be repaired by inventing observations.

## Further reading

- [How to read a time-series relationship study](/docs/help/basics/time-series-relationships)
- [How to read a multivariate time-series study](/docs/help/basics/multivariate-time-series-relationships)
- [Understand ETF strategy backtests](/docs/help/backtesting/etf-strategy)
