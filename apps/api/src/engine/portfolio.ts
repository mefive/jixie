import type { CostModel, Position } from './types.js';

/** Cash + positions, with cost-aware fills and mark-to-market. Prices are adjusted (hfq). */
export class Portfolio {
  cash: number;
  positions = new Map<string, Position>();
  trades = 0;

  constructor(
    initialCash: number,
    private cost: CostModel,
  ) {
    this.cash = initialCash;
  }

  /** Max whole shares buyable at `price` given current cash and buy-side fees (never goes negative). */
  affordableShares(price: number): number {
    if (price <= 0) return 0;
    const n = Math.floor(this.cash / (price * (1 + this.cost.commission + this.cost.transferFee)));
    return Math.max(0, n);
  }

  /** Total equity given a price lookup (suspended → its position is held at the carried price). */
  equity(priceOf: (code: string) => number | null): number {
    let v = this.cash;
    for (const [code, p] of this.positions) {
      const px = priceOf(code);
      if (px != null) v += p.shares * px;
    }
    return v;
  }

  private buyFee(value: number): number {
    return Math.max(value * this.cost.commission, this.cost.minCommission) + value * this.cost.transferFee;
  }

  private sellFee(value: number): number {
    return (
      Math.max(value * this.cost.commission, this.cost.minCommission) +
      value * this.cost.stampDuty +
      value * this.cost.transferFee
    );
  }

  /** Execute a fill of `delta` shares (+buy / -sell) at `price` on `date`. */
  fill(code: string, delta: number, price: number, date: string, sellableFrom: string): void {
    if (Math.abs(delta) < 1e-9 || price <= 0) return;
    const value = Math.abs(delta) * price;

    if (delta > 0) {
      const fee = this.buyFee(value);
      this.cash -= value + fee;
      const pos = this.positions.get(code) ?? { shares: 0, avgCost: 0, frozenUntil: sellableFrom };
      pos.avgCost = (pos.avgCost * pos.shares + value + fee) / (pos.shares + delta);
      pos.shares += delta;
      pos.frozenUntil = sellableFrom; // T+1: freshly bought shares sellable next day
      this.positions.set(code, pos);
    } else {
      const pos = this.positions.get(code);
      if (!pos) return;
      const fee = this.sellFee(value);
      this.cash += value - fee;
      pos.shares += delta; // delta < 0
      if (pos.shares < 1e-6) this.positions.delete(code);
    }
    this.trades++;
  }
}
