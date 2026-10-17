import type { FactorDependency } from '@jixie/shared';
import type { BacktestingResult } from '#backtesting/result.js';

/**
 * 表示一次已执行成交，作为持久化回测日志与图表单位。
 *
 * One executed fill — the trade log unit (returned with the result; plotted + listed in the UI).
 */
export interface BacktestTrade {
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
  assetType?: 'stock' | 'etf' | 'future';
  actualCode?: string; // mapped delivery contract for a logical continuous futures order
  contracts?: number; // futures quantity in contracts
  multiplier?: number; // CNY per index point
}

/**
 * 定义持久化回测结果，并保留历史成交可选字段的读取兼容性。
 *
 * Persisted report contract; legacy optional trade fields remain readable here.
 */
export interface BacktestResult extends Omit<BacktestingResult, 'tradeLog'> {
  tradeLog: BacktestTrade[];
  factorDependencies?: FactorDependency[];
}
