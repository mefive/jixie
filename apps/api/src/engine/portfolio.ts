import type { CostModel, Position, TradeRecord } from './types.js';

type CashAssetType = 'stock' | 'etf';

/** Cash + positions, with cost-aware fills and mark-to-market. Prices are adjusted (hfq). */
export class Portfolio {
  cash: number;
  positions = new Map<string, Position>();
  trades: TradeRecord[] = []; // every executed fill, in order

  constructor(
    initialCash: number,
    private cost: CostModel,
  ) {
    this.cash = initialCash;
  }

  /** Max adjusted shares buyable as whole real-share lots, including minimum commission. */
  affordableShares(price: number, assetType: CashAssetType, adj: number): number {
    return this.affordableRealShares(price, assetType, adj) / adj;
  }

  /** Shares currently available to sell; only the most recent T+1 purchase layer is frozen. */
  sellableShares(code: string, date: string): number {
    const position = this.positions.get(code);
    if (!position) {
      return 0;
    }
    const frozen = position.frozenUntil > date ? (position.frozenShares ?? position.shares) : 0;
    return Math.max(0, position.shares - Math.min(position.shares, frozen));
  }

  /** Total equity given a price lookup (suspended → its position is held at the carried price). */
  equity(priceOf: (code: string) => number | null): number {
    return this.cash + this.marketValue(priceOf);
  }

  /** Gross long stock market value. */
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

  private buyFee(value: number, assetType: CashAssetType): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      (assetType === 'stock' ? value * this.cost.transferFee : 0)
    );
  }

  private sellFee(value: number, assetType: CashAssetType): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      (assetType === 'stock' ? value * (this.cost.stampDuty + this.cost.transferFee) : 0)
    );
  }

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

  /** Execute a fill of `delta` hfq shares (+buy / -sell) at hfq `price` on `date`. `adj` is the day's
   * adj_factor, used to enforce A-share whole-lot (100-share) sizing in REAL shares and to record the real
   * (unadjusted) price/shares the user sees. Buys floor to whole lots (deploy ≤ budget); sells clear the
   * requested hfq amount as-is (so positions fully exit — no hfq dust from dividend drift over the hold). */
  fill(
    code: string,
    delta: number,
    price: number,
    date: string,
    sellableFrom: string,
    adj: number,
    assetType: CashAssetType = 'stock',
    preSlippagePrice = price,
  ): void {
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
    this.trades.push({
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
    });
  }
}
