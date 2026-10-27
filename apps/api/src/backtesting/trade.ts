/**
 * 表示一次已执行成交，是报告成交日志与图表共用的基本单位。
 *
 * One executed fill — the trade log unit (returned with the result; plotted + listed in the UI).
 */
interface TradeFill {
  date: string; // fill date (next open after the order)
  code: string;
  side: 'buy' | 'sell';
  shares: number; // hfq shares (engine-internal accounting)
  price: number; // hfq (adjusted) fill price (engine-internal)
  amount: number; // realShares × realPrice = shares × price (trade value, real money)
  fee: number; // commission + stamp + transfer
  slippageCost: number; // adverse fill-price loss versus the unslipped open
  realShares: number; // real shares filled — buys are whole lots (100 shares each)
  realPrice: number; // unadjusted (raw) fill price — what you'd actually have paid
}

/**
 * 记录股票或 ETF 成交，保留复权与真实价格数量以及费用。
 *
 * Represent a stock or ETF fill with adjusted and real quantities, prices and costs.
 */
export interface CashTrade extends TradeFill {
  assetType: 'stock' | 'etf';
}

/**
 * 现金账户成交记录，供绩效汇总使用。
 *
 * Cash-account fill record for performance aggregation.
 */
export type TradeRecord = CashTrade;
