import type {
  AllocationAnalysis,
  AllocationAssetClass,
  AllocationDriftEvent,
  AllocationWeightPoint,
  MultiAssetClass,
} from '@jixie/shared';
import type { CustomFactorModule } from './custom-factor.js';
import type { Position, TradeRecord } from './types.js';

const CASH = 'CASH';

interface AssetAccumulator {
  assetId: string;
  assetClass: AllocationAssetClass;
  weightSum: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  dailyNetReturns: number[];
}

/** The approved Panel research universe is the authoritative exposure taxonomy for a run. */
export function allocationAssetClasses(
  modules: CustomFactorModule[] | undefined,
): Map<string, MultiAssetClass> {
  const classes = new Map<string, MultiAssetClass>();
  for (const module of modules ?? []) {
    for (const asset of module.assetUniverse ?? module.panelComposite?.assetUniverse ?? []) {
      const existing = classes.get(asset.assetId);
      if (existing && existing !== asset.assetClass) {
        throw new Error(`conflicting asset classes for ${asset.assetId}`);
      }
      classes.set(asset.assetId, asset.assetClass);
    }
  }
  return classes;
}

/** Produces exact daily component P&L and compact allocation diagnostics inside the engine. */
export class AllocationAnalysisTracker {
  private readonly assets = new Map<string, AssetAccumulator>();
  private readonly previousShares = new Map<string, number>();
  private readonly previousClose = new Map<string, number>();
  private readonly portfolioReturns: number[] = [];
  private readonly drift: AllocationDriftEvent[] = [];
  private previousEquity: number;
  private observations = 0;

  constructor(
    private readonly initialCash: number,
    private readonly assetClasses: Map<string, MultiAssetClass>,
  ) {
    this.previousEquity = initialCash;
    for (const [assetId, assetClass] of assetClasses) {
      this.assets.set(assetId, emptyAsset(assetId, assetClass));
    }
  }

  captureDay(args: {
    value: number;
    positions: ReadonlyMap<string, Position>;
    closeOf: (assetId: string) => number | null;
    trades: TradeRecord[];
  }): void {
    const codes = new Set<string>([
      ...this.assets.keys(),
      ...this.previousShares.keys(),
      ...args.positions.keys(),
      ...args.trades.map((trade) => trade.code),
    ]);
    for (const code of codes) {
      this.ensureAsset(code);
    }

    const netPnlByAsset = new Map<string, number>();
    for (const code of codes) {
      const accumulator = this.assets.get(code)!;
      const close = args.closeOf(code) ?? this.previousClose.get(code) ?? null;
      const previousClose = this.previousClose.get(code);
      const previousShares = this.previousShares.get(code) ?? 0;
      let grossPnl =
        close != null && previousClose != null ? previousShares * (close - previousClose) : 0;
      let fees = 0;
      let slippage = 0;

      for (const trade of args.trades) {
        if (trade.code !== code || trade.assetType === 'future') {
          continue;
        }
        const signedShares = trade.side === 'buy' ? trade.shares : -trade.shares;
        const tradeSlippage = trade.slippageCost ?? 0;
        if (close != null) {
          // Add slippage back here so gross P&L is measured at the unslipped execution price.
          grossPnl += signedShares * (close - trade.price) + tradeSlippage;
        }
        fees += trade.fee;
        slippage += tradeSlippage;
      }

      accumulator.grossPnl += grossPnl;
      accumulator.fees += fees;
      accumulator.slippage += slippage;
      const netPnl = grossPnl - fees - slippage;
      netPnlByAsset.set(code, netPnl);

      const position = args.positions.get(code);
      if (position && close != null && args.value > 0) {
        accumulator.weightSum += (position.shares * close) / args.value;
      }
      if (close != null) {
        this.previousClose.set(code, close);
      }
    }

    const denominator = this.previousEquity > 0 ? this.previousEquity : this.initialCash;
    this.portfolioReturns.push(denominator > 0 ? args.value / denominator - 1 : 0);
    for (const accumulator of this.assets.values()) {
      accumulator.dailyNetReturns.push((netPnlByAsset.get(accumulator.assetId) ?? 0) / denominator);
    }
    this.previousShares.clear();
    for (const [code, position] of args.positions) {
      this.previousShares.set(code, position.shares);
    }
    this.previousEquity = args.value;
    this.observations += 1;
  }

  weights(
    cash: number,
    positions: ReadonlyMap<string, Position>,
    priceOf: (assetId: string) => number | null,
  ): Map<string, number> {
    const values = new Map<string, number>([[CASH, cash]]);
    let equity = cash;
    for (const [assetId, position] of positions) {
      const value = position.shares * (priceOf(assetId) ?? 0);
      values.set(assetId, value);
      equity += value;
    }
    return new Map(
      [...values].map(([assetId, value]) => [assetId, equity > 0 ? value / equity : 0]),
    );
  }

  captureRebalance(args: {
    decisionDate: string;
    executionDate: string;
    targets: ReadonlyMap<string, number>;
    preTrade: ReadonlyMap<string, number>;
    postTrade: ReadonlyMap<string, number>;
  }): void {
    const target = new Map(args.targets);
    target.set(CASH, 1 - [...args.targets.values()].reduce((sum, value) => sum + value, 0));
    const assetIds = [
      ...new Set([...target.keys(), ...args.preTrade.keys(), ...args.postTrade.keys()]),
    ]
      .filter((assetId) => assetId !== CASH)
      .sort();
    assetIds.push(CASH);
    this.drift.push({
      decisionDate: args.decisionDate,
      executionDate: args.executionDate,
      target: this.weightPoints(assetIds, target),
      preTrade: this.weightPoints(assetIds, args.preTrade),
      postTrade: this.weightPoints(assetIds, args.postTrade),
      preTradeDistance: weightDistance(assetIds, target, args.preTrade),
      postTradeDistance: weightDistance(assetIds, target, args.postTrade),
      maxPostTradeDeviation: Math.max(
        0,
        ...assetIds.map((assetId) =>
          Math.abs((target.get(assetId) ?? 0) - (args.postTrade.get(assetId) ?? 0)),
        ),
      ),
    });
  }

  finish(finalValue: number): AllocationAnalysis {
    const portfolioPnl = finalValue - this.initialCash;
    const totalFees = [...this.assets.values()].reduce((sum, asset) => sum + asset.fees, 0);
    const totalSlippage = [...this.assets.values()].reduce((sum, asset) => sum + asset.slippage, 0);
    const rawRisk = new Map<string, number | null>();
    const portfolioVariance = centeredSumOfSquares(this.portfolioReturns);
    for (const asset of this.assets.values()) {
      rawRisk.set(
        asset.assetId,
        portfolioVariance > 0
          ? centeredCrossProduct(asset.dailyNetReturns, this.portfolioReturns) / portfolioVariance
          : null,
      );
    }
    const rawRiskTotal = [...rawRisk.values()].reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    );
    const riskOf = (assetId: string): number | null => {
      const value = rawRisk.get(assetId);
      return value == null || Math.abs(rawRiskTotal) < 1e-12 ? null : value / rawRiskTotal;
    };

    const assets = [...this.assets.values()]
      .map((asset) => {
        const costs = asset.fees + asset.slippage;
        const netPnl = asset.grossPnl - costs;
        return {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          averageWeight: this.observations > 0 ? asset.weightSum / this.observations : 0,
          grossPnl: asset.grossPnl,
          costs,
          netPnl,
          returnContribution: this.initialCash > 0 ? netPnl / this.initialCash : 0,
          riskContribution: riskOf(asset.assetId),
        };
      })
      .filter(
        (asset) =>
          this.assetClasses.has(asset.assetId) ||
          Math.abs(asset.netPnl) > 1e-8 ||
          asset.averageWeight > 1e-8,
      )
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl));
    const assetClasses = [...new Set(assets.map((asset) => asset.assetClass))]
      .map((assetClass) => {
        const rows = assets.filter((asset) => asset.assetClass === assetClass);
        return {
          assetClass,
          averageWeight: rows.reduce((sum, row) => sum + row.averageWeight, 0),
          grossPnl: rows.reduce((sum, row) => sum + row.grossPnl, 0),
          costs: rows.reduce((sum, row) => sum + row.costs, 0),
          netPnl: rows.reduce((sum, row) => sum + row.netPnl, 0),
          returnContribution: rows.reduce((sum, row) => sum + row.returnContribution, 0),
          riskContribution: rows.some((row) => row.riskContribution != null)
            ? rows.reduce((sum, row) => sum + (row.riskContribution ?? 0), 0)
            : null,
        };
      })
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl));
    const attributedNetPnl = assets.reduce((sum, asset) => sum + asset.netPnl, 0);
    const residual = portfolioPnl - attributedNetPnl;
    const tolerance = Math.max(0.01, Math.abs(portfolioPnl) * 1e-8);

    return {
      version: 1,
      methodology: 'daily_component_pnl',
      riskMethodology: 'component_covariance',
      observations: this.observations,
      reconciliation: {
        portfolioPnl,
        attributedNetPnl,
        residual,
        tolerance,
        reconciled: Math.abs(residual) <= tolerance,
      },
      costs: { fees: totalFees, slippage: totalSlippage, total: totalFees + totalSlippage },
      assets,
      assetClasses,
      drift: this.drift,
    };
  }

  private ensureAsset(assetId: string): void {
    if (this.assets.has(assetId)) {
      return;
    }
    const asset = emptyAsset(assetId, this.assetClasses.get(assetId) ?? 'other');
    asset.dailyNetReturns = Array(this.observations).fill(0);
    this.assets.set(assetId, asset);
  }

  private weightPoints(
    assetIds: string[],
    weights: ReadonlyMap<string, number>,
  ): AllocationWeightPoint[] {
    return assetIds.map((assetId) => ({
      assetId,
      assetClass: assetId === CASH ? 'other' : (this.assetClasses.get(assetId) ?? 'other'),
      weight: weights.get(assetId) ?? 0,
    }));
  }
}

function emptyAsset(assetId: string, assetClass: AllocationAssetClass): AssetAccumulator {
  return {
    assetId,
    assetClass,
    weightSum: 0,
    grossPnl: 0,
    fees: 0,
    slippage: 0,
    dailyNetReturns: [],
  };
}

function weightDistance(
  assetIds: string[],
  target: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): number {
  return (
    assetIds.reduce(
      (sum, assetId) => sum + Math.abs((target.get(assetId) ?? 0) - (actual.get(assetId) ?? 0)),
      0,
    ) / 2
  );
}

function centeredSumOfSquares(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0);
}

function centeredCrossProduct(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  const leftAverage = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightAverage = right.reduce((sum, value) => sum + value, 0) / right.length;
  return left.reduce(
    (sum, value, index) => sum + (value - leftAverage) * (right[index] - rightAverage),
    0,
  );
}
