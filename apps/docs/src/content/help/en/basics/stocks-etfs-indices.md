# Stocks, ETFs, and indices

A stock represents part ownership of a company. An ETF is an exchange-traded basket of assets. An index is a rule-based market reference. They appear in different parts of the product.

## Stocks

Stocks have tradable codes, prices, and volume, and may have company metrics such as PE, dividend yield, and market capitalization.

Screener primarily filters stocks when you use company metrics. Strategy can buy and sell stocks.

Common misunderstanding: a low share price does not mean a stock has a low valuation.

## ETFs

An ETF usually tracks a basket of stocks, bonds, commodities, or an index. It can be queried in Screener and traded in Strategy.

Stock valuation fields do not always apply to ETFs. An ETF provides diversification across its holdings, but still has market, liquidity, and tracking risk.

### ETF directory and download list

The platform synchronizes the full ETF metadata directory. On first initialization it selects the 100 listed ETFs with the largest fund size from one latest source-date snapshot. Administrators maintain this download list through the server CLI. Daily synchronization keeps manual edits; removing a code stops further downloads and preserves existing prices.

Ranking uses `totalSize`, not fund units. Missing size is reported and never replaced with zero or an estimate; an administrator can add such a code manually. Today's selected sample is not the historical top 100 at every date and is not an investment recommendation.

Search results distinguish metadata from locally available price history. Missing prices produce a data gap rather than a substitute product. Coverage begins at different dates for different ETFs.

Do not treat a proxy as identical to its underlying asset:

- A QDII ETF trades in CNY on a China exchange; its return also reflects FX, fees, premium or discount, and non-synchronous market closes.
- A bond ETF's holdings and duration can drift; it is not a constant-maturity yield curve.
- A commodity ETF can include futures roll, collateral, and tracking effects.
- Money-market ETF distribution and return semantics have not passed the platform gate, so the current registry does not treat one as an ordinary cash proxy.

Historical shares, fund size and NAV research series have been removed. The latest size snapshot serves download selection only; a future unit-change dashboard is separate work.

## Indices

An index is a calculated reference such as the CSI 300. It usually cannot be traded directly.

Administrators maintain a small index download list through the server CLI. Prices serve backtest benchmarks, historical constituents serve equity universes, and official valuations serve the valuation page. Each dataset follows its actual source coverage; missing data is not fabricated.

Outperforming an index does not necessarily mean making a profit. Both the strategy and the index can fall.

## Quick comparison

| Item | Stock | ETF | Index |
| --- | --- | --- | --- |
| Directly tradable | Yes | Yes | Usually no |
| Represents | One company | A basket of assets | A market reference |
| Common use here | Screening, charts, backtests | Queries, comparisons, backtests | Benchmarks, market, valuation |

## Related articles

- [Complete your first quantitative study](/help/getting-started/first-research)
- [Use the research data catalog](/docs/help/research/data-catalog)
- [Strategies and backtests](/help/basics/strategy-backtest)
