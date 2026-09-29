/** One executed fill — the trade log unit (returned with the result; plotted + listed in the UI). */
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

export interface CashTrade extends TradeFill {
  assetType: 'stock' | 'etf';
}
export interface FuturesTrade extends TradeFill {
  assetType: 'future';
  actualCode: string;
  contracts: number;
  multiplier: number;
}
export type TradeRecord = CashTrade | FuturesTrade;
