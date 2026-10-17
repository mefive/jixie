/**
 * 表示一次已执行成交，是报告成交日志与图表共用的基本单位。
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
 * Represent a stock or ETF fill with adjusted and real quantities, prices and costs.
 */
export interface CashTrade extends TradeFill {
  assetType: 'stock' | 'etf';
}

/**
 * 记录期货成交的实际交割合约、合约数、乘数及费用。
 * Represent a futures fill with its delivery contract, count, multiplier and costs.
 */
export interface FuturesTrade extends TradeFill {
  assetType: 'future';
  actualCode: string;
  contracts: number;
  multiplier: number;
}

/**
 * 统一现金与期货成交联合类型，供绩效汇总按资产种类分派。
 * Unify cash and futures fills so performance consumers can dispatch by asset type.
 */
export type TradeRecord = CashTrade | FuturesTrade;
