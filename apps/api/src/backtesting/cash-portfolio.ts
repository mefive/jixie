import type { CostModel } from './cost.js';
import type { CashTrade } from './trade.js';

/**
 * 表示持有的现金资产仓位；仅冻结数量在 T+1 解冻日前不可卖出。
 *
 * A held position. Only frozenShares remain unavailable until frozenUntil (T+1).
 */
export interface Position {
  shares: number;
  avgCost: number;
  frozenUntil: string;
  frozenShares?: number;
}

/**
 * 区分股票与 ETF 的现金成交费用和交易规则。
 *
 * Distinguish stock and ETF cash fills when applying instrument-specific fees and rules.
 */
type CashAssetType = 'stock' | 'etf';

/**
 * 承载一次现金成交的复权数量、价格、交易日及解冻日期，供账户统一记账。
 *
 * Describe an adjusted-share cash fill and its execution and sellability dates for account posting.
 */
export interface CashFill {
  source?: string;
  code: string;
  adjustedShareDelta: number;
  adjustedPrice: number;
  date: string;
  sellableFrom: string;
  adjustmentFactor: number;
  assetType: CashAssetType;
  referenceAdjustedPrice?: number;
}

/** Cash + positions, with cost-aware fills and mark-to-market. Prices are adjusted (hfq). */
export class CashPortfolio {
  cash: number;
  positions = new Map<string, Position>();
  trades: CashTrade[] = []; // every executed fill, in order

  constructor(
    initialCash: number,
    private cost: CostModel,
    private onFill?: (trade: CashTrade, source: string) => void,
  ) {
    this.cash = initialCash;
  }

  /**
   * 计算计入最低佣金后可买入的最大复权数量，实际股数须满足整手要求。
   *
   * Max adjusted shares buyable as whole real-share lots, including minimum commission.
   */
  affordableShares(price: number, assetType: CashAssetType, adj: number): number {
    return this.affordableRealShares(price, assetType, adj) / adj;
  }

  /**
   * 计算指定日期可卖出的数量，仅扣除仍受 T+1 限制的冻结层。
   *
   * Shares currently available to sell; only the most recent T+1 purchase layer is frozen.
   */
  sellableShares(code: string, date: string): number {
    const position = this.positions.get(code);
    if (!position) {
      return 0;
    }
    const frozen = position.frozenUntil > date ? (position.frozenShares ?? position.shares) : 0;
    return Math.max(0, position.shares - Math.min(position.shares, frozen));
  }

  /**
   * 按给定价格查询计算现金加持仓市值；停牌资产的估值价格由调用方提供。
   *
   * Total equity given a price lookup (suspended → its position is held at the carried price).
   */
  equity(priceOf: (code: string) => number | null): number {
    return this.cash + this.marketValue(priceOf);
  }

  /**
   * 按价格查询汇总现金账户多头持仓市值。
   *
   * Gross long stock market value.
   */
  marketValue(priceOf: (code: string) => number | null): number {
    let v = 0;
    for (const [code, p] of this.positions) {
      const px = priceOf(code);
      if (px != null) {
        v += p.shares * px;
      }
    }
    return v;
  }

  /**
   * 计算股票或 ETF 买入费用，计入最低佣金及股票过户费。
   *
   * Compute cash buy fees with minimum commission and stock-only transfer fees.
   */
  private buyFee(value: number, assetType: CashAssetType): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      (assetType === 'stock' ? value * this.cost.transferFee : 0)
    );
  }

  /**
   * 计算股票或 ETF 卖出费用，股票另计印花税与过户费。
   *
   * Compute cash sell fees with stock-only stamp duty and transfer fees.
   */
  private sellFee(value: number, assetType: CashAssetType): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      (assetType === 'stock' ? value * (this.cost.stampDuty + this.cost.transferFee) : 0)
    );
  }

  /**
   * 用二分搜索计算现金可覆盖的最大百股整手数量，同时计入买入费用。
   *
   * Binary-search affordable 100-share lots including buy-side fees; invalid price or adjustment inputs yield zero.
   */
  private affordableRealShares(price: number, assetType: CashAssetType, adj: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(adj) || price <= 0 || adj <= 0) {
      return 0;
    }
    const realPrice = price / adj;
    let low = 0;
    let high = Math.max(0, Math.floor(this.cash / (realPrice * 100)));
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const value = middle * 100 * realPrice;
      if (value + this.buyFee(value, assetType) <= this.cash + 1e-9) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low * 100;
  }

  /**
   * 按复权数量执行买卖并同步现金、费用、持仓及 T+1 冻结层；买入按实际股数向下取整手，卖出允许清理复权尾差。
   *
   * Execute adjustedShareDelta (+buy / -sell) at adjustedPrice on date. adjustmentFactor is the day's
   * adj_factor, used to enforce A-share whole-lot (100-share) sizing in REAL shares and to record the real
   * (unadjusted) price/shares the user sees. Buys floor to whole lots (deploy ≤ budget); sells clear the
   * requested hfq amount as-is (so positions fully exit — no hfq dust from dividend drift over the hold).
   */
  fill(input: CashFill): void {
    const {
      code,
      adjustedPrice: price,
      date,
      sellableFrom,
      adjustmentFactor: adj,
      assetType,
      referenceAdjustedPrice: preSlippagePrice = price,
    } = input;
    let delta = input.adjustedShareDelta;
    if (![delta, price, adj].every(Number.isFinite)) {
      throw new Error(`Fill inputs for ${code} must be finite numbers`);
    }
    if (Math.abs(delta) < 1e-9 || price <= 0 || adj <= 0) {
      return;
    }

    let realShares: number;
    if (delta > 0) {
      const requestedRealLots = Math.floor((delta * adj) / 100) * 100;
      const realLots = Math.min(
        requestedRealLots,
        this.affordableRealShares(price, assetType, adj),
      );
      if (realLots < 100) {
        return;
      } // can't afford even one lot
      delta = realLots / adj; // back to hfq for the ledger (marking stays hfq)
      realShares = realLots; // exact whole lots
    } else {
      const sellable = this.sellableShares(code, date);
      delta = -Math.min(-delta, sellable);
      if (Math.abs(delta) < 1e-9) {
        return;
      }
      realShares = Math.abs(delta) * adj; // sell: real count (drifts off lot boundary by reinvested dividends)
    }

    const value = Math.abs(delta) * price; // real money (= realShares × realPrice)
    const slippageCost = Math.abs(price - preSlippagePrice) * Math.abs(delta);
    const realPrice = price / adj;
    let fee: number;

    if (delta > 0) {
      fee = this.buyFee(value, assetType);
      this.cash -= value + fee;
      const pos = this.positions.get(code) ?? {
        shares: 0,
        avgCost: 0,
        frozenUntil: sellableFrom,
        frozenShares: 0,
      };
      const existingFrozen = pos.frozenUntil > date ? (pos.frozenShares ?? pos.shares) : 0;
      pos.avgCost = (pos.avgCost * pos.shares + value + fee) / (pos.shares + delta);
      pos.shares += delta;
      pos.frozenUntil = sellableFrom;
      pos.frozenShares = sellableFrom > date ? existingFrozen + delta : 0;
      this.positions.set(code, pos);
    } else {
      const pos = this.positions.get(code);
      if (!pos) {
        return;
      }
      fee = this.sellFee(value, assetType);
      this.cash += value - fee;
      pos.shares += delta; // delta < 0
      if (pos.frozenUntil <= date) {
        pos.frozenShares = 0;
      }
      if (pos.shares < 1e-6) {
        this.positions.delete(code);
      }
    }
    const trade: CashTrade = {
      date,
      code,
      side: delta > 0 ? 'buy' : 'sell',
      shares: Math.abs(delta),
      price,
      amount: value,
      fee,
      slippageCost,
      realShares,
      realPrice,
      assetType,
    };
    this.trades.push(trade);
    this.onFill?.(trade, input.source ?? 'order');
  }
}
