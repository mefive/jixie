# Stocks, ETFs, and indices

A stock represents part ownership of a company. An ETF is an exchange-traded basket of assets. An index is a rule-based market reference. They appear in different parts of the product.

## Stocks

Stocks have tradable codes, prices, and volume, and may have company metrics such as PE, dividend yield, and market capitalization.

Screener primarily filters stocks when you use company metrics. Backtest Lab can buy and sell stocks.

Common misunderstanding: a low share price does not mean a stock has a low valuation.

## ETFs

An ETF usually tracks a basket of stocks, bonds, commodities, or an index. It can be queried in Screener and traded in Backtest Lab.

Stock valuation fields do not always apply to ETFs. An ETF provides diversification across its holdings, but still has market, liquidity, and tracking risk.

### Current ETF research registry

The platform keeps the full ETF directory, but it does not store a decade of prices for every duplicate product. The current versioned registry selects 82 primary or backup products for 71 exposures across China equity benchmarks and styles, sectors, overseas markets, bonds, convertibles, gold, and commodities. One exposure normally has one primary product and at most one backup.

Search results distinguish product metadata from locally available history. An ETF is available to research or backtests only when local daily prices and adjustment factors actually exist. Listing dates differ, so coverage does not start on the same date for every product.

Do not treat a proxy as identical to its underlying asset:

- A QDII ETF trades in CNY on a China exchange; its return also reflects FX, fees, premium or discount, and non-synchronous market closes.
- A bond ETF's holdings and duration can drift; it is not a constant-maturity yield curve.
- A commodity ETF can include futures roll, collateral, and tracking effects.
- Money-market ETF distribution and return semantics have not passed the platform gate, so the current registry does not treat one as an ordinary cash proxy.

Historical shares and fund size are stored for registry quality and capacity audits. They are generally available only on the next trading day, and fund size is not the amount that can be traded without market impact. This dataset is not intraday creation, redemption, or arbitrage data.

## Indices

An index is a calculated reference such as the CSI 300. It usually cannot be traded directly.

Backtest results use the CSI 300 as a benchmark. The Market and Valuation pages use indices to show market conditions and historical valuation.

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
