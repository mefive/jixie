# Decile and forward returns

Decile returns test whether subsequent stock returns form a reasonably consistent order as factor values move from low to high. The page divides eligible stocks into D1 through D10 in every period.

## Forward return

The factor is calculated on the rebalance date. The forward return is observed after that date. For stock \(i\), the return from \(t\) to the next period \(t+1\) is:

$$
r_{i,t\rightarrow t+1}
=
\frac{P^{adj}_{i,t+1}}{P^{adj}_{i,t}}-1
$$

- \(P^{adj}_{i,t}\) is the adjusted close on the rebalance date.
- \(P^{adj}_{i,t+1}\) is the adjusted close on the next observation date.
- \(r_{i,t\rightarrow t+1}\) is the return over that interval.

If the adjusted close changes from 10.00 to 10.50:

$$
r=\frac{10.50}{10}-1=5\%
$$

“Forward” means that the return occurs after the factor observation. It does not mean the system knew the return in advance.

## How stocks enter D1 through D10

On each rebalance date, the analysis:

1. Calculates each stock's factor value using information available at the time.
2. Ranks the values from low to high.
3. Divides the stocks into ten groups of approximately equal size.
4. Labels the lowest group D1 and the highest group D10.
5. Calculates each group's next-period return.

For earnings yield, D1 has the lowest values and D10 has the highest. D10 is not a recommendation of ten stocks; it is the highest decile for that period.

## Equal-weight return

Equal weighting gives every stock in the group the same weight:

$$
R^{equal}_{q,t}
=
\frac{1}{N_{q,t}}
\sum_{i\in D_{q,t}}r_{i,t\rightarrow t+1}
$$

- \(D_{q,t}\) is group \(q\) in period \(t\).
- \(N_{q,t}\) is the number of stocks in the group.
- \(R^{equal}_{q,t}\) is the group's equal-weight return.

If three stocks return 2%, −1%, and 5%:

$$
R^{equal}=\frac{2\%-1\%+5\%}{3}=2\%
$$

Equal-weight results can be strongly influenced by small companies because every stock receives the same weight.

## Market-cap-weight return

Market-cap weighting gives larger companies more weight:

$$
R^{mktcap}_{q,t}
=
\frac{\sum_{i\in D_{q,t}}MV_{i,t}\,r_{i,t\rightarrow t+1}}
{\sum_{i\in D_{q,t}}MV_{i,t}}
$$

\(MV_{i,t}\) is total market capitalization on the rebalance date.

If three stocks have weights of 10%, 20%, and 70%, while returning 2%, −1%, and 5%:

$$
R^{mktcap}
=10\%\times2\%+20\%\times(-1\%)+70\%\times5\%
=3.5\%
$$

Equal weighting emphasizes the ranking signal. Market-cap weighting gives a better view of whether a similar result exists among larger, more scalable positions. A large difference can indicate that small stocks drive the result.

## Read the page

The numbered areas are:

1. Equal-weight and market-cap-weight switch.
2. Next-period annualized returns for D1 through D10.
3. Axis and direction definition.

![Equal or market-cap weighting and decile returns](/help/zh/factors/factor-deciles-01.png)

1. Open a completed factor report.
2. Select **Equal weight**.
3. Check whether D1 through D10 generally rise or fall in order.
4. Switch to **Market-cap weight**.
5. Check whether the group order remains.

Annualization provides a common display convention. It is not a forecast for the next year.

## Judge the result

Check whether:

- D1 through D10 are reasonably monotonic instead of differing only at the endpoints.
- Equal- and market-cap-weight directions agree.
- One extreme group alone drives the conclusion.
- The order disappears in another reasonable period.
- The net-of-cost long-short result remains viable.

A historically high D10 return does not mean every current D10 stock will rise.

## Related articles

- [Rank IC, ICIR, and IC decay](/help/factors/rank-ic-icir)
- [Turnover, trading costs, and net returns](/help/factors/turnover-costs)
- [Size and industry neutralization](/help/factors/neutralization)
