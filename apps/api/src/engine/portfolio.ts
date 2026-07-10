import type { CostModel, Position, TradeRecord } from './types.js';

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

  /** Max whole shares buyable at `price` given current cash and buy-side fees (never goes negative). */
  affordableShares(price: number): number {
    if (price <= 0) {
      return 0;
    }
    const n = Math.floor(this.cash / (price * (1 + this.cost.commission + this.cost.transferFee)));
    return Math.max(0, n);
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

  private buyFee(value: number): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      value * this.cost.transferFee
    );
  }

  private sellFee(value: number): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      value * this.cost.stampDuty +
      value * this.cost.transferFee
    );
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
  ): void {
    if (Math.abs(delta) < 1e-9 || price <= 0 || adj <= 0) {
      return;
    }

    let realShares: number;
    if (delta > 0) {
      const realLots = Math.floor((delta * adj) / 100) * 100; // real shares, floored to whole lots
      if (realLots < 100) {
        return;
      } // can't afford even one lot
      delta = realLots / adj; // back to hfq for the ledger (marking stays hfq)
      realShares = realLots; // exact whole lots
    } else {
      realShares = Math.abs(delta) * adj; // sell: real count (drifts off lot boundary by reinvested dividends)
    }

    const value = Math.abs(delta) * price; // real money (= realShares × realPrice)
    const realPrice = price / adj;
    let fee: number;

    if (delta > 0) {
      fee = this.buyFee(value);
      this.cash -= value + fee;
      const pos = this.positions.get(code) ?? { shares: 0, avgCost: 0, frozenUntil: sellableFrom };
      pos.avgCost = (pos.avgCost * pos.shares + value + fee) / (pos.shares + delta);
      pos.shares += delta;
      pos.frozenUntil = sellableFrom; // T+1: freshly bought shares sellable next day
      this.positions.set(code, pos);
    } else {
      const pos = this.positions.get(code);
      if (!pos) {
        return;
      }
      fee = this.sellFee(value);
      this.cash += value - fee;
      pos.shares += delta; // delta < 0
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
      realShares,
      realPrice,
    });
  }
}
